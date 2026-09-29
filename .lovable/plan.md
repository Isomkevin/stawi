# Floating Ask Stawi chat

## What will change
- Remove Ask Stawi from the co-op navigation and keep its existing page address as a redirect back to the co-op overview.
- Add an **Ask Stawi** launcher fixed to the bottom-right of every co-op screen.
- Open the chat in a right-side modal on larger screens and a full-screen modal on phones.
- Add maximize, minimize, and close controls while preserving the current conversation when the modal changes size.
- Keep the existing live financial snapshot, streaming answers, suggested questions, stop control, and error handling.

## Chat experience
- Use the standard AI chat building blocks for the transcript, markdown answers, loading state, and composer.
- Give Ask Stawi a Stawi-specific leaf identity, accessible labels, keyboard-friendly controls, and mobile-safe spacing.
- Keep user messages high-contrast and assistant responses unboxed for readability.

## Validation
- Confirm the launcher appears across co-op screens without covering important controls.
- Test opening, asking a question, stopping, maximizing, minimizing, closing, and reopening on desktop and mobile.
- Check the app for errors and verify the redesigned chat visually.

## Technical details
- Mount one shared chat overlay in the co-op layout so its state survives navigation between co-op screens.
- Reuse the current `/api/coop-assistant` request and full conversation-history behavior; no financial logic or server contract changes.
