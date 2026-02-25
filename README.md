## Neuron — Knowledge Graph Builder

Interactive app for turning rich JSON into an explorable knowledge graph, as seen at [`https://hhrishikeshh.github.io/NeuralLearning/neuron-app.html`](https://hhrishikeshh.github.io/NeuralLearning/neuron-app.html).

### How to run locally

- **Open the HTML file**: just open `neuron-app.html` in any modern browser (Chrome, Edge, Firefox, Safari).
- **Or via a simple server**:
  - From this directory run, for example: `python -m http.server 8000`
  - Then visit `http://localhost:8000/neuron-app.html` in your browser.

### Usage: two main flows

- **Flow 1 — Generate a prompt (you don’t have JSON yet)**
  - On the landing screen, type your **topic** and choose a **depth level** (`EXPLORER`, `PRACTITIONER`, `RESEARCHER`).
  - Click **“Generate Knowledge Prompt →”**.
  - On the next screen, copy the generated prompt (Step 1) into your preferred LLM (Claude, GPT‑4, Gemini, etc.).
  - Ask the model to respond with **JSON only**.
  - Paste the full JSON response into the **“Paste the JSON output here”** textarea.
  - Wait for the app to validate the JSON; when it’s valid, the **“Visualize Knowledge Graph →”** button becomes enabled.
  - Click **“Visualize Knowledge Graph →”** to see the interactive map.

- **Flow 2 — Already have JSON**
  - On the landing screen, click **“Already have JSON? Paste & visualize →”**.
  - You’ll go straight to the JSON paste step (the prompt copy step is hidden).
  - Paste your pre‑generated JSON into the textarea.
  - When validation succeeds, click **“Visualize Knowledge Graph →”** to open the map.

### JSON format (important)

- The app expects a single JSON object with:
  - **`topic`**, **`depth`**, **`summary`**
  - **`categories`**: each with `id`, `label`, `color`, `icon`, `description`
  - **`nodes`**: each with `id`, `label`, `category`, `hot`, `depth_level`, `description`, `prerequisites`, optional `analogy`
  - **`links`**: each with `source`, `target`, `relation`, `type`, `weight`, optional `label`
  - **`learningPath`** and **`metadata`** as described in the in‑app schema.
- Inside the app, click **“View expected JSON schema”** under the paste box to see the full structure and rules.

### Navigating the graph

- **Pan / zoom**: drag to pan, scroll to zoom, or use the `+`, `−`, and `⊡` buttons.
- **Hover nodes** to see details and prerequisites in the tooltip.
- **Click nodes** to focus their connections (other nodes and links are dimmed).
- **Search** using the search box in the top bar.
- **Legend**: click domain entries in the **Domains** panel to highlight nodes in that category.
- **Learning Path**:
  - Toggle the **“Learning Path”** panel on the right.
  - Click steps to mark them complete and track progress.

### Typical workflow

- **1. Choose a topic and depth**.
- **2. Generate and copy the prompt** into your LLM (or skip this if you already have JSON).
- **3. Paste the JSON output**, fix any schema issues the validator reports.
- **4. Launch the graph** and explore concepts, relations, and the learning path visually.
