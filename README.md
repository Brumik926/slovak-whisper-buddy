Brumík AI — English README ready. Shall I commit this to the repository (directly to default branch) or create a new branch + PR?

README content (English):

# Brumík AI — Slovak Whisper Buddy

Brumík AI is your Slovak-speaking AI companion and assistant. The app processes speech (Whisper / speech-to-text), understands user input, and provides helpful responses and recommendations.

Live demo: https://slovak-whisper-buddy.lovable.app  
Lovable editor: https://lovable.dev/projects/b8cf87d0-ad6f-40d8-9c11-5c5a92c94028

Main features
- Slovak speech recognition (Whisper)
- Interactive AI conversations
- Easy local development and deployment via Lovable
- Extensible architecture for additional models or plugins

Quick start (local)
1. Clone the repository
   git clone https://github.com/Brumik926/slovak-whisper-buddy.git
   cd slovak-whisper-buddy
2. Install dependencies and run the dev server
   npm install
   npm run dev
3. Open your browser at http://localhost:3000 (or the port the app uses)

Requirements
- Node.js (recommended to manage with nvm)  
- npm or yarn  
- (Optional) Access to OpenAI or other model APIs and the corresponding API keys, if used by the app

Configuration (ENV)
Add a .env file with these example variables (adjust to the project):
NODE_ENV=development
PORT=3000
OPENAI_API_KEY=your_api_key_here
WHISPER_MODEL=small

Note: Do not commit sensitive API keys to the repository.

Deployment
- Lovable: changes made in the Lovable editor sync to this repository and can be deployed via the live URL.
- Vercel / Netlify / custom server: follow the platform’s steps and ensure required environment variables are set.

Project structure (quick overview)
- src/ — application source code
- src/routes/ — file-based routes
- public/ — static assets
- README.md — project overview

Testing
- If tests exist: npm test
- If there are no tests yet, consider adding basic unit and end-to-end tests (Jest, Playwright/Cypress).

Contributing
1. Fork the repository
2. Create a feature branch: git checkout -b feat/your-feature
3. Commit your changes and open a pull request
4. Describe your changes in the PR and include screenshots or demo if helpful

Suggested improvements
- Add screenshots or a short GIF demonstrating the app
- Add badges (build, license, live demo)
- Add a .env.example with the required environment variables
- Add a Security / Privacy section explaining how voice data is handled and retained
- Add CONTRIBUTING.md and CODE_OF_CONDUCT.md

License
- Add a license file (e.g., MIT). Tell me which license you prefer and I can add LICENSE.

Contact / Acknowledgements
- Author: Brumík (Brumik926)  
- Thanks: Lovable, OpenAI, and any third-party libraries used

Would you like me to:
1) Commit this README.md directly to the repository default branch, or  
2) Create a new branch and open a PR with the change?
