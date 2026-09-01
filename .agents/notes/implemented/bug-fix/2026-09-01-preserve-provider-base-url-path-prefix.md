# Agent Note: preserve provider base URL path prefixes

Status: implemented

English | [中文](2026-09-01-preserve-provider-base-url-path-prefix.zh.md)

## Problem

The company model proxy resolved every Chat Completions request against the absolute path `/v1/chat/completions`. That worked for provider origins such as `https://api.deepseek.com`, but it discarded a configured base URL path. DashScope's OpenAI-compatible base URL `https://dashscope.aliyuncs.com/compatible-mode/v1` therefore became `https://dashscope.aliyuncs.com/v1/chat/completions` and returned 404 even though the credential and model were valid.

The catalog calls the field an endpoint, while the administration console presents a provider address. Neither surface asks an administrator to construct an operation URL, and the Runner cannot supply or correct any provider path under the decision that [a Runner names a model and nothing else](../architecture/2026-08-30-a-runner-names-a-model-and-nothing-else.md).

## Decision

The company model proxy treats the catalog endpoint as an OpenAI-compatible base URL. It removes trailing slashes from the configured path, appends `chat/completions` when that path ends in `/v1`, and otherwise appends `v1/chat/completions`. It also discards a base URL query and fragment, matching the existing operation-specific URL behavior.

This rule preserves deployment prefixes such as `/compatible-mode/v1` and `/openai/v1`. A provider origin with no path still reaches `/v1/chat/completions`, so existing DeepSeek catalog rows keep their request URL.

## Alternatives considered

**Keep an absolute `/v1/chat/completions` path.** Rejected because it makes every configured path prefix inert and prevents the Control Plane from reaching OpenAI-compatible providers whose version path is not at the origin root.

**Store the complete Chat Completions URL in the catalog.** Rejected because the field is a provider base URL shared with administration and future operation mappings. Making one operation part of the stored value would couple catalog data to the only operation this transport currently carries.

**Always append `chat/completions`.** Rejected because existing provider origins such as `https://api.deepseek.com` rely on the proxy adding `/v1`; preserving prefixed providers does not require changing those rows.

## Consequences

Company model rows can use OpenAI-compatible provider base URLs with path prefixes. The proxy still supports only Chat Completions; another operation needs its own mapping from the same base URL.

A base URL whose intended prefix does not end in `/v1` receives an added `/v1`. Administrators must store the provider's documented OpenAI-compatible base URL rather than a complete operation URL.

## Testing

The model-gateway HTTP integration test drives a real provider server through authorization, credential resolution, proxying, and settlement. It pins both a root provider origin reaching `/v1/chat/completions` and a DashScope-style `/compatible-mode/v1` base reaching `/compatible-mode/v1/chat/completions`.
