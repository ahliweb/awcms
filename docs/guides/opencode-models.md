> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# How to Choose and Use AI Models in OpenCode

OpenCode lets you switch between configured AI models directly in your development environment. This guide covers the current repo-level configuration points and the safest generic model-selection patterns.

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for AI/Agent integration patterns
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references

## 1. Quick Switch via UI

The easiest way to switch models is through the OpenCode interface:

- **Sidebar Header**: Click the active model name shown in the OpenCode sidebar header to open the available model list.
- **Agent Manager**: Switch to the **Agent Manager** view (usually via the gear icon or a specific tab) to see a comprehensive list of models and their capabilities.

## 2. Terminal Commands

You can interact with model settings using the OpenCode Terminal User Interface (TUI):

- **List Models**: Type `/models` in the OpenCode terminal to inspect currently available models.
- **Connect Providers**: Type `/connect` if your local OpenCode install supports interactive provider setup.
- **Select Model**: Use `/model <model-id>` to switch directly to a specific model.

## 3. Keyboard Shortcuts

Boost your efficiency with these shortcuts:

- **Switch Model**: `Ctrl + O` (Linux/Windows) or `Cmd + O` (Mac) opens the interactive model selection menu.
- **New Session**: `Ctrl + Shift + Esc` (Linux/Windows) or `Cmd + Shift + Esc` (Mac) starts a fresh session, allowing you to pick a model from the start.

## 4. Configuration (`opencode.json`)

For advanced users, you can set your default model in the runtime configuration file:

1. Locate your `opencode.json` file (the repo documents `~/.config/opencode/opencode.json` as the standard runtime path).
2. Set the `"model"` key:

   ```json
   {
      "model": "openai/gpt-5.4"
    }
    ```

3. Replace the example with any provider/model ID exposed by your configured runtime.
4. OpenCode will prioritize this setting on startup.

## 5. Repo-Specific Notes

- Repo MCP topology lives in `mcp.json`.
- Runtime client configuration lives in `~/.config/opencode/opencode.json`.
- Use `opencode mcp list` to verify that the repo's documented MCP servers are connected before troubleshooting model or tool availability.

---

> [!TIP]
> Prefer your team's default high-context reasoning model for cross-repo refactors, and switch to lighter/cheaper models only for narrow follow-up edits.
