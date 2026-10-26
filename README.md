# Ink to Text

Build "Ink to Text", a student-friendly web app that turns handwritten notes into editable digital text and a downloadable PDF.

Flow:

1. Homepage: short welcome, a clear "Upload a handwritten note" button (PNG, JPG or PDF).

2. Editor page: original upload on the left; on the right two tabs, "Edit" (editable text area) and "Preview" (clean serif page).

3. Read the handwriting with an AI vision model and put the result in the Edit tab.

4. Mark words the model is unsure about, clearly, and say when recognition is uncertain.

5. Show spelling suggestions the user can accept or reject one by one. Never change the user's text silently.

6. Download the final text as a PDF and as a .txt file.

Design: blue palette (primary #2563EB, deep blue #1E3A8A, soft blue #EAF2FF, page #F5F8FF), rounded cards, subtle shadows, generous spacing, readable fonts, works on phone and laptop.

Rules: never show fake or placeholder recognition results. If recognition fails, show a clear, friendly error.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ee2dc379-4686-4eac-922c-a85a6661648f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
