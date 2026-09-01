# Agent Note: 保留 Provider Base URL 的路径前缀

Status: implemented

[English](2026-09-01-preserve-provider-base-url-path-prefix.md) | 中文

## 问题

公司模型代理曾把每个 Chat Completions 请求解析到绝对路径 `/v1/chat/completions`。这对 `https://api.deepseek.com` 这类 Provider Origin 有效，却会丢弃已配置 Base URL 的路径。于是 DashScope 的 OpenAI 兼容 Base URL `https://dashscope.aliyuncs.com/compatible-mode/v1` 会变成 `https://dashscope.aliyuncs.com/v1/chat/completions`，即使凭据与模型都有效也会返回 404。

目录把这个字段称为 endpoint，管理控制台则把它呈现为 Provider 地址。两个入口都没有要求管理员构造操作 URL；按照 [Runner 只为模型命名](../architecture/2026-08-30-a-runner-names-a-model-and-nothing-else.zh.md)的决策，Runner 也不能提供或修正任何 Provider 路径。

## 决策

公司模型代理把目录 endpoint 视作 OpenAI 兼容 Base URL。它移除配置路径末尾的斜线；当路径以 `/v1` 结尾时追加 `chat/completions`，否则追加 `v1/chat/completions`。它也丢弃 Base URL 的 query 与 fragment，与既有的特定操作 URL 行为一致。

这条规则保留 `/compatible-mode/v1`、`/openai/v1` 之类的部署前缀。没有路径的 Provider Origin 仍然到达 `/v1/chat/completions`，因此现有 DeepSeek 目录行保持原请求 URL。

## 曾考虑的替代方案

**保留绝对路径 `/v1/chat/completions`。** 否决，因为它会让每个已配置的路径前缀失效，使 Control Plane 无法到达版本路径不在 Origin 根目录的 OpenAI 兼容 Provider。

**在目录中存储完整的 Chat Completions URL。** 否决，因为该字段是管理入口与未来操作映射共享的 Provider Base URL。把一个操作写进存储值，会让目录数据耦合到当前 Transport 唯一承载的操作。

**总是追加 `chat/completions`。** 否决，因为 `https://api.deepseek.com` 这类既有 Provider Origin 依赖代理补上 `/v1`；保留带前缀 Provider 不需要修改这些目录行。

## 后果

公司模型目录行可以使用含路径前缀的 OpenAI 兼容 Provider Base URL。代理仍然只支持 Chat Completions；另一种操作需要从同一个 Base URL 建立自己的映射。

预期前缀不以 `/v1` 结尾的 Base URL 会被追加 `/v1`。管理员必须存储 Provider 文档给出的 OpenAI 兼容 Base URL，而不是完整的操作 URL。

## 测试

model-gateway HTTP 集成测试让一个真实 Provider 服务器经过授权、凭据解析、代理与结算。它同时钉住根 Provider Origin 到达 `/v1/chat/completions`，以及 DashScope 风格的 `/compatible-mode/v1` Base 到达 `/compatible-mode/v1/chat/completions`。
