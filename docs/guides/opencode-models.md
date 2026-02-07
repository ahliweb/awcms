> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# How to Choose and Use AI Models in OpenCode Zen

OpenCode Zen allows you to switch between various AI models (like Gemini, Claude, and OpenAI) directly within your development environment. This guide explains how to select and configure these models.

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for AI/Agent integration patterns
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references

## 1. Quick Switch via UI

The easiest way to switch models is through the OpenCode Zen interface:

- **Sidebar Header**: Click the model name displayed at the top of the OpenCode sidebar (e.g., "Gemini 3 Pro"). A dropdown menu will appear with available options.
- **Agent Manager**: Switch to the **Agent Manager** view (usually via the gear icon or a specific tab) to see a comprehensive list of models and their capabilities.

## 2. Terminal Commands

You can interact with model settings using the OpenCode Terminal User Interface (TUI):

- **List Models**: Type `/models` in the OpenCode terminal to see all available AI models.
- **Connect Providers**: Type `/connect` to add new API keys for different providers (OpenAI, Anthropic, Google, etc.).
- **Select Model**: Use `/model <model-id>` to switch directly to a specific model.

## 3. Keyboard Shortcuts

Boost your efficiency with these shortcuts:

- **Switch Model**: `Ctrl + O` (Linux/Windows) or `Cmd + O` (Mac) opens the interactive model selection menu.
- **New Session**: `Ctrl + Shift + Esc` (Linux/Windows) or `Cmd + Shift + Esc` (Mac) starts a fresh session, allowing you to pick a model from the start.

## 4. Configuration (`opencode.json`)

For advanced users, you can set your default model in the configuration file:

1. Locate your `opencode.json` file (usually in the root of your workspace or in your user configuration directory).
2. Set the `"model"` key:

   ```json
   {
     "model": "google/gemini-pro"
   }
   ```

3. OpenCode will prioritize this setting on startup.

## 5. Premium Method: Antigravity Auth (Recommended)

To leverage your **Antigravity** credentials and access **Gemini 3 Pro** without a separate API key:

1. **Install Plugin**:

   ```bash
   opencode plugin add opencode-antigravity-auth
   ```

2. **Authenticate**:
   Run `opencode auth login`, select **Google**, and choose **OAuth with Google (Antigravity)**.
3. **Configure**:
   Update your `~/.config/opencode/opencode.json`:

   ```json
   {
     "plugin": ["opencode-antigravity-auth"],
     "model": "google/gemini-3-pro-preview"
   }
   ```

---

> [!TIP]
> **Gemini 1.5 Pro** and **Claude 3.5 Sonnet** are recommended for complex refactoring tasks due to their large context windows.
