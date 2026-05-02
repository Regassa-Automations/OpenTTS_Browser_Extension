# OpenTTS Browser Extension

**High-fidelity, Speechify-style text-to-speech for the price of a coffee.**

OpenTTS is a Chrome extension designed for users who want premium, natural-sounding AI voices without the $20+/month subscription fees. By leveraging the **OpenRouter API** and **GPT-4o Mini TTS**, you can listen to over 100 hours of content for approximately **$5.00 USD**.

---

## 🚀 Features

* **Natural AI Voices:** Access OpenAI’s world-class voices (Alloy, Echo, Fable, Onyx, Nova, and Shimmer).
* **Speechify-Style UI:** Injects a "Play" button $(\blacktriangleright)$ at the start of every paragraph on any website.
* **Floating Control HUD:** A sleek, persistent player at the bottom of your screen with:
    * Play/Pause
    * Rewind/Fast-Forward (15s)
    * Paragraph skipping (Next/Previous)
* **Auto-Advance:** Seamlessly reads from one paragraph to the next for a hands-free experience.
* **Extreme Cost Efficiency:** Costs ~$0.60 per 1 million characters. Your $5.00 budget lasts roughly 130 hours of audio.
* **Privacy First:** Your API key is stored locally in your browser. No middle-man servers.

---

## 🛠️ Installation (Developer Mode)

Since this is a custom-built tool, you can install it manually in seconds:

1.  **Download/Clone** this repository to a folder on your computer.
2.  Open Google Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** using the toggle in the top-right corner.
4.  Click **Load unpacked** and select the folder where you saved this project.
5.  Click the **Extension Puzzle Piece** icon in your browser bar and pin **OpenTTS**.

---

## ⚙️ Configuration

1.  **Get an API Key:** Sign up at [OpenRouter.ai](https://openrouter.ai), add a small credit balance (e.g., $5.00), and generate an API key.
2.  **Set Up the Extension:** * Right-click the OpenTTS icon and select **Options**.
    * Paste your **OpenRouter API Key**.
    * Select your preferred **Voice** and **Speed**.
    * Hit **Save**.

---

## 📖 How to Use

1.  **Navigate** to any article, blog post, or website.
2.  **Look for the Play Icon:** A small $(\blacktriangleright)$ will appear next to each paragraph.
3.  **Click Play:** The audio will begin, and the floating control bar will appear at the bottom of the page.
4.  **Listen & Scroll:** The extension will automatically highlight the paragraph it is currently reading and move to the next one when finished.

---

## 🏗️ Technical Architecture

* **Manifest V3:** Built using the latest Chrome extension standards for security and performance.
* **Background Service Worker:** Orchestrates API calls to OpenRouter and manages the reading queue.
* **Offscreen Document:** Utilized to handle the HTML5 Audio API, ensuring playback continues even when the popup is closed.
* **MutationObserver:** Monitors the page for new content (perfect for infinite-scroll sites like Reddit or X).

---

## 💰 Cost Comparison (2026 Estimates)

| Service | Price | Audio Hours (approx.) |
| :--- | :--- | :--- |
| ElevenLabs | $5.00/mo | ~30 Minutes |
| Speechify | $11.50/mo | Limited by Tier |
| **OpenTTS** | **$5.00/mo** | **130+ Hours** |

---

## 📝 License
MIT License. Feel free to fork, modify, and use for your own personal reading workflows!
