# Feed Pipeline

Static RSS/Atom feed processing pipeline for GitHub Actions and GitHub Pages.

Current built-in features:

- `translate`: translate selected item fields into a target language
- `summary`: summarize one item field and prepend the result to the same field

Config lives in the `state` worktree at `config/feeds.yaml`.

Example:

```yaml
translate:
  systemPrompt: |
    You are a feed translation assistant.
    Return only translated text.

summary:
  systemPrompt: |
    你是一个 RSS 摘要助手。
    只输出中文 Markdown 摘要正文，不要标题，不要代码块，不要解释。

feeds:
  - path: /readwise
    url: https://wise.readwise.io/feed
    translate:
      targetLanguage: zh-CN
      fields:
        - title
        - content:encoded
    summary:
      sourceField: description
      prompt: |
        提炼这期内容的核心主题和重点推荐，控制在 2-4 句。
    limit: 10
```

Commands:

- `npm run feed:build`
- `npm run feed:update-readme`
- `npm run feed:commit-state`
