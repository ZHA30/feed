import * as DomUtils from "domutils";
import renderDom from "dom-serializer";
import { Element, Text, type AnyNode } from "domhandler";
import { parseDocument } from "htmlparser2";

export interface HtmlBlock {
  blockPath: string;
  text: string;
}

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "td", "th", "figcaption", "summary"]);
const FALLBACK_BLOCK_TAGS = new Set(["div", "section", "article"]);
const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "meta",
  "link",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "svg",
  "canvas",
  "iframe",
  "video",
  "audio",
  "picture",
  "source",
  "pre",
  "code",
  "kbd",
  "samp",
  "var",
  "nav",
  "footer",
  "aside",
]);

const SKIP_ATTR_PATTERN = /\b(notranslate|translated|breadcrumb|breadcrumbs|crumb|code|highlight|syntax|hljs|ad|ads|advert|sponsor|promo|banner|recommend|related|author|byline|meta|metadata|dateline)\b/i;
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export function hasHtmlStructure(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

export function extractHtmlBlocks(html: string): HtmlBlock[] {
  const document = parseDocument(html, { decodeEntities: true });
  return markTranslatableBlocks(document.children);
}

export function reinsertHtmlTranslations(html: string, translations: Map<string, string>): string {
  if (translations.size === 0) {
    return html;
  }

  const document = parseDocument(html, { decodeEntities: true });
  markTranslatableBlocks(document.children);
  for (const node of DomUtils.findAll((node): node is Element => node instanceof Element, document.children)) {
    const blockPath = node.attribs["data-feed-block"];
    if (blockPath === undefined) {
      continue;
    }
    const translated = translations.get(blockPath)?.trim();
    delete node.attribs["data-feed-block"];
    if (!translated) {
      continue;
    }
    node.children.push(new Element("span", { class: "translated" }, [
      new Element("br", {}, []),
      new Text(translated),
    ]));
  }

  return renderDom(document.children, { encodeEntities: "utf8" });
}

function markTranslatableBlocks(children: Element["children"]): HtmlBlock[] {
  const blocks: HtmlBlock[] = [];
  let index = 0;

  for (const node of DomUtils.findAll((node): node is Element => node instanceof Element, children)) {
    if (!isCandidateBlock(node)) {
      continue;
    }
    if (hasCandidateDescendant(node)) {
      continue;
    }
    const text = normalizeText(textContentForTranslation(node.children));
    if (!isUsefulText(text) || isLowValueBlock(node, text)) {
      continue;
    }
    node.attribs["data-feed-block"] = String(index);
    blocks.push({
      blockPath: String(index),
      text,
    });
    index++;
  }

  return blocks;
}

function isCandidateBlock(node: Element): boolean {
  const tag = node.name.toLowerCase();
  if (shouldSkipNode(node)) {
    return false;
  }
  return BLOCK_TAGS.has(tag) || FALLBACK_BLOCK_TAGS.has(tag);
}

function hasCandidateDescendant(node: Element): boolean {
  const tag = node.name.toLowerCase();
  if (!FALLBACK_BLOCK_TAGS.has(tag)) {
    return false;
  }
  return DomUtils.findOne((child) => child instanceof Element && BLOCK_TAGS.has(child.name.toLowerCase()) && !shouldSkipNode(child), node.children) !== null;
}

function shouldSkipNode(node: Element): boolean {
  const tag = node.name.toLowerCase();
  if (SKIP_TAGS.has(tag)) {
    return true;
  }
  const attrs = node.attribs;
  if (attrs.translate === "no" || "data-no-translate" in attrs || attrs.hidden !== undefined || attrs["aria-hidden"] === "true") {
    return true;
  }
  const style = attrs.style ?? "";
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) {
    return true;
  }
  const attrText = `${attrs.class ?? ""} ${attrs.id ?? ""} ${attrs.role ?? ""} ${attrs["aria-label"] ?? ""}`;
  return SKIP_ATTR_PATTERN.test(attrText);
}

function isLowValueBlock(node: Element, text: string): boolean {
  if (/^(home|首页)\s*([>/|]|$)/i.test(text)) {
    return true;
  }
  if (HEADING_TAGS.has(node.name.toLowerCase())) {
    return false;
  }
  const links = DomUtils.findAll((child): child is Element => child instanceof Element && child.name.toLowerCase() === "a", node.children);
  const linkTextLength = links.reduce((total, link) => total + normalizeText(textContentForTranslation(link.children)).length, 0);
  return text.length > 0 && linkTextLength / text.length > 0.6;
}

function textContentForTranslation(nodes: AnyNode[]): string {
  let text = "";
  for (const node of nodes) {
    if (node instanceof Text) {
      text += node.data;
      continue;
    }
    if (node instanceof Element) {
      if (shouldSkipNode(node)) {
        continue;
      }
      text += textContentForTranslation(node.children);
    }
  }
  return text;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isUsefulText(value: string): boolean {
  if (value.length < 2) {
    return false;
  }
  if (/^(https?:\/\/\S+|\S+@\S+|\d+|[^\p{L}\p{N}]+)$/u.test(value)) {
    return false;
  }
  if (/^(advertisement|sponsored|promoted|相关阅读|相关推荐)$/i.test(value)) {
    return false;
  }
  return true;
}
