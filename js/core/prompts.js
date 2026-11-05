// Prompt templates for generating NCF knowledge maps with an external LLM.
export const SCHEMA_DISPLAY = `{
  "_ncf": "1",
  "topic": "string",
  "depth": "explorer | practitioner | researcher",
  "summary": "string",

  "categories": [
    {
      "id": "string",
      "label": "string",
      "color": "#hex",
      "icon": "single emoji",
      "description": "string"
    }
  ],

  "N_cols": ["id","label","cat","hot","dl","desc","info","prereq","analogy"],
  "N": [
    ["node_id", "Label", "category_id", 1, 1,
     "description string",
     "additionalInfo string",
     ["prereq_id"],
     null]
  ],

  "L_cols": ["src","tgt","rel","tp","w","lbl"],
  "L": [
    ["source_id","target_id","relation_type","hierarchical|semantic|cross_domain",1|2|3,"optional label"]
  ],

  "LP_cols": ["ni","o","ph","rs","em","ki"],
  "LP": [
    ["node_id", 1, "Phase Name", "reason string", 15, "key insight string"]
  ],

  "meta": {
    "tc": number,
    "tl": number,
    "central": "node_id",
    "insights": ["string"],
    "next": ["string"],
    "misconceptions": ["string"]
  }
}

Column definitions:
  N_cols:  id=node id, label=display name, cat=category id, hot=1|0, dl=depth level 1-3,
           desc=description, info=additionalInfo, prereq=prerequisites array, analogy=string|null
  L_cols:  src=source node id, tgt=target node id, rel=relation type, tp=link type,
           w=weight 1-3, lbl=label string
  LP_cols: ni=nodeId, o=order number, ph=phase name, rs=reason, em=estimatedMinutes, ki=keyInsight`;

export function buildPrompt(topic, depth) {
return `╔══════════════════════════════════════════════════════════════════════════════════╗
║                     NEURON — SEMANTIC KNOWLEDGE GRAPH PROMPT                     ║
║                              Model-Agnostic v1.0                                 ║
╚══════════════════════════════════════════════════════════════════════════════════╝

You are a Semantic Knowledge Cartographer.

Your task is to map the topic below as a LIVING KNOWLEDGE GRAPH — the way an expert
mind actually stores and retrieves understanding. Not a textbook index. Not a Wikipedia
outline. A semantic web where every concept lives at the correct distance from every
other concept, connected by the invisible threads of meaning.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOPIC:     ${topic}
DEPTH:     ${depth}   [ explorer = 12-18 nodes | practitioner = 30-45 nodes | researcher = 60-90 nodes ]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PHILOSOPHY — READ THIS BEFORE GENERATING ANYTHING:

  The human brain encodes knowledge through SEMANTIC PROXIMITY.
  Things that mean similar things cluster together in memory.
  Things that are USED together or FEEL similar also pull toward each other —
  even across completely different domains.

  This is why:
  → Entropy (thermodynamics) and Uncertainty (information theory) feel like the same idea
  → Stoic resilience and Antifragility (Taleb) and Buddhist non-attachment are the same concept in different clothes
  → Eigenvectors (linear algebra) and Principal Components (statistics) and Latent Space (ML) are one idea at different zoom levels

  Your graph must reflect this. Categories are just loose gravity wells.
  MEANING is what pulls nodes together. The force simulation will do the spatial work —
  your job is to encode the WEIGHT and NATURE of every connection correctly.

  A good graph should let a beginner see the shape of the territory before they
  enter it. A great graph should show an expert something they hadn't consciously
  connected before.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DEPTH GUIDELINES:

  EXPLORER (12-18 nodes)
  → The 10,000 ft view. What are the 5-6 gravity wells of this topic?
  → Every node must be something a beginner needs to know EXISTS before they can learn anything else
  → Links are mostly structural — what feeds into what
  → Learning path = the order a great teacher would introduce these ideas in a first lecture
  → Minimum 2 cross-domain bridges (concepts that live in other fields but are the SAME idea)

  PRACTITIONER (30-45 nodes)
  → The working map. What does someone need to actually USE this knowledge?
  → Include: patterns, failure modes, trade-offs, and the "hidden" concepts that tutorials skip
  → Links include contrast (X vs Y, they live close because comparison is how the brain learns them together)
  → At least 5 cross-domain bridges
  → Learning path should have clear "unlock" moments — nodes that suddenly make 3 others make sense

  RESEARCHER (60-90 nodes)
  → The full territory including the edges and the fog
  → Include: historical origins, dead-ends, open questions, minority viewpoints, and the surprising bridges
  → At least 15 cross-domain bridges — this is where quantum physics meets philosophy, where thermodynamics meets information theory
  → Some nodes should represent things still debated or unknown (mark depth_level: 3)
  → Learning path is a genuine curriculum with phases, not just a sequence

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LINK TYPES — THIS IS THE MOST IMPORTANT PART:

  Every link must have a "relation" that describes the SEMANTIC NATURE of the connection.
  This is what makes the graph feel like a mind, not a flowchart.

  Use exactly one of these values for the "relation" field:

  "feeds_into"      → A is required to understand B (prerequisite, foundational)
  "is_a_type_of"    → A is a specific case of B (taxonomy — use sparingly)
  "contrasts_with"  → A and B are best understood as a pair/opposition (e.g. synchronous vs async)
  "enables"         → Understanding A makes B dramatically easier to learn
  "is_analog_of"    → A and B are the same concept in different domains (cross-domain bridge)
  "emerges_from"    → B is a surprising consequence or property that arises from A
  "is_applied_as"   → A in theory becomes B in practice
  "historically_led_to" → A came before B and caused or inspired it (researcher depth)
  "is_often_confused_with" → A and B are frequently mixed up — this link is a warning
  "is_the_inverse_of"  → A and B are mirror operations (e.g. encoding/decoding, encryption/decryption)
  "shares_structure_with" → A and B have the same underlying shape/pattern (deep analogy)

  Link weight controls VISUAL DISTANCE in the simulation:
  weight: 3 = very close (almost the same thing)
  weight: 2 = clearly related
  weight: 1 = connected but distant

  The "is_analog_of" and "shares_structure_with" links are the most valuable.
  They are the ones that create "I never thought of it that way" moments.
  Prioritize them. They are rarely obvious.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NODE DESCRIPTIONS — HOW TO WRITE THEM:

  A node description is NOT a dictionary definition.
  It is a one-sentence answer to: "Why does this matter in the context of ${topic}?"

  BAD:  "Entropy is a measure of disorder in a thermodynamic system."
  GOOD: "Entropy is why complex systems naturally drift toward chaos — understanding
         it tells you why maintaining any ordered system requires constant energy."

  BAD:  "A load balancer distributes incoming network traffic across servers."
  GOOD: "A load balancer is the traffic cop that prevents any single server from
         becoming the bottleneck that takes down your whole system."

  The description should create a MENTAL HOOK — something the user can attach
  future knowledge to. Write it the way a mentor would explain it, not a textbook.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ADDITIONAL INFO — HOW TO WRITE IT (required for every node):

  "additionalInfo" is shown in a popup when the user clicks a node. It must give the
  learner enough to understand this concept in context and how the whole map fits together.

  For EACH node, write additionalInfo that:
  1. Explains the concept sufficiently — what it is, why it matters, and (if helpful) a brief example or analogy.
  2. Describes how this node connects to its dependent and related nodes (prerequisites, links). Name specific node concepts where it helps. Make the interconnections explicit so the learner sees how pieces depend on each other.
  3. States how this concept serves the main topic — its role in the bigger picture. A learner who reads all additionalInfo across the map (in learning-path order or by exploring) should gain a coherent, depth-appropriate understanding of the topic.

  Length scales with depth (roughly half to one page per node when printed):
  → EXPLORER: 2–4 short paragraphs (3–6 sentences total). Focus on clarity and place in the map.
  → PRACTITIONER: 4–6 paragraphs. Include connections, trade-offs, and how it fits the topic.
  → RESEARCHER: 6–10+ paragraphs. Deeper nuance, cross-domain ties, and how it serves the main topic.

  Write in clear, continuous prose. No bullet lists unless the model deems them clearer. The tone should be mentor-like: one expert explaining to a curious learner. If a node has no prerequisites, still explain how it connects to the rest of the graph and serves the topic.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LEARNING PATH — HOW TO ORDER IT:

  The learning path is not just topological sort of prerequisites.
  It is a PEDAGOGICAL SEQUENCE — the order that minimizes confusion and maximizes
  the number of "aha" moments.

  Rules for ordering:
  1. Start with the concept that gives the most CONTEXT for everything else
     (often not the simplest concept, but the one that makes others make sense)
  2. Concrete before abstract. Examples before theory.
  3. Group nodes that are best learned as a pair (contrasts_with links) — learn them in sequence
  4. "Unlock" nodes first — a node that has 3+ dependents should come early
  5. End with the nodes that integrate everything (synthesis nodes, or applied nodes)

  For each step, the "reason" field must answer:
  "Why NOW? What does learning this HERE unlock that learning it earlier or later wouldn't?"

  estimatedMinutes should reflect genuine cognitive effort:
  → Simple factual node: 5-10 min
  → Conceptual node requiring examples: 15-25 min
  → Deep node requiring practice: 30-60 min
  → Cross-domain insight node: 20-40 min (these take time to land)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CATEGORY COLORS — GUIDELINES:

  Colors should feel semantically appropriate, not random:
  → Foundation/structural concepts: cool blues (#4fc3f7, #00b8d4)
  → Dynamic/process concepts: warm ambers/oranges (#ffb74d, #ff9a3c)
  → Abstract/theoretical concepts: purples (#c77dff, #9c64ff)
  → Applied/practical concepts: greens (#69f0ae, #a8ff78)
  → Warning/tricky concepts: reds/pinks (#ff6b6b, #f48fb1)
  → Meta/philosophical concepts: cyans (#00e5ff, #80deea)

  Colors must be distinct enough to read on a very dark (#020508) background.
  Do NOT use colors darker than #558 in any channel.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CROSS-DOMAIN INSIGHT GUIDELINES:

  The "crossDomainInsights" in metadata should be 2-3 sentence observations that
  a knowledgeable generalist would find genuinely illuminating.

  BAD:  "Quantum computing is related to physics."
  GOOD: "The concept of superposition in quantum computing is structurally identical
         to how a neural network holds probabilistic activations before a decision
         boundary — both are systems that exist in multiple states until forced to commit."

  These insights are what elevate the map from reference material to genuine education.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OUTPUT FORMAT — NCF (Neuron Compact Format):

  To reduce token usage while preserving all content, output a COLUMNAR JSON format.
  Keys are defined ONCE at the top of each section; values are positional arrays.
  This is the ONLY accepted output format. Do not use the verbose key-per-row format.

  COLUMN ORDER IS FIXED AND MANDATORY:
  N_cols  (nodes):        ["id","label","cat","hot","dl","desc","info","prereq","analogy"]
  L_cols  (links):        ["src","tgt","rel","tp","w","lbl"]
  LP_cols (learningPath): ["ni","o","ph","rs","em","ki"]

  COLUMN DEFINITIONS:
  Nodes:
    id      = node id (lowercase_underscores, globally unique, max 30 chars)
    label   = display name (max 4 words)
    cat     = category id (must match a category)
    hot     = 1 (true) or 0 (false)
    dl      = depth_level: 1 | 2 | 3
    desc    = description (mentor-style, 1 sentence, why this matters HERE)
    info    = additionalInfo (full paragraphs per ADDITIONAL INFO guidelines — do NOT shorten)
    prereq  = prerequisites array of node ids (empty array [] if none)
    analogy = analogy string or null

  Links:
    src = source node id
    tgt = target node id
    rel = relation (one of the 11 relation types)
    tp  = "hierarchical" | "semantic" | "cross_domain"
    w   = weight: 1 | 2 | 3
    lbl = label string (3-5 words, or empty string "")

  LearningPath:
    ni = nodeId
    o  = order number
    ph = phase name
    rs = reason (why NOW)
    em = estimatedMinutes
    ki = keyInsight (single sentence)

  META FIELDS (short keys):
    tc            = totalConcepts
    tl            = totalLinks
    central       = centralNode (node id)
    insights      = crossDomainInsights (array of strings)
    next          = suggestedNextTopics (array of strings)
    misconceptions = commonMisconceptions (array of strings)

  EXAMPLE (2 nodes, 1 link, 1 learning path step):
  {
    "_ncf": "1",
    "topic": "...",
    "depth": "explorer",
    "summary": "...",
    "categories": [{"id":"foundations","label":"Foundations","color":"#4fc3f7","icon":"🌱","description":"..."}],
    "N_cols": ["id","label","cat","hot","dl","desc","info","prereq","analogy"],
    "N": [
      ["cap_theorem","CAP Theorem","foundations",1,1,"CAP is why every distributed system is a compromise.","CAP Theorem states that...",[],"Like choosing a phone plan — unlimited calls OR data, never both."],
      ["sharding","Sharding","foundations",0,2,"Sharding is how you scale a database horizontally.","When your data grows beyond one server...",[" cap_theorem"],null]
    ],
    "L_cols": ["src","tgt","rel","tp","w","lbl"],
    "L": [
      ["cap_theorem","sharding","feeds_into","hierarchical",3,"partitioning requires tradeoffs"]
    ],
    "LP_cols": ["ni","o","ph","rs","em","ki"],
    "LP": [
      ["cap_theorem",1,"Foundations","CAP first — it reframes every database decision.",25,"Every distributed system is a negotiation."],
      ["sharding",2,"Core Mechanics","Now that CAP is clear, sharding is the practical response.",20,"Scale by splitting data, but you inherit coordination costs."]
    ],
    "meta": {
      "tc": 2, "tl": 1, "central": "cap_theorem",
      "insights": ["CAP Theorem is structurally identical to the Uncertainty Principle..."],
      "next": ["Distributed Systems Internals"],
      "misconceptions": ["CAP means pick 2-of-3 forever — actually the tradeoff is dynamic"]
    }
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HARD RULES (violations will break the application):

  R1. Output ONLY valid NCF JSON. No prose. No markdown. No \`\`\`json fences. Start with { end with }
  R2. All node "id" values: lowercase, underscores only, globally unique, max 30 chars
  R3. Every link "source" and "target" must exactly match an existing node id
  R4. Every "prerequisites" entry must exactly match an existing node id
  R5. Every "learningPath" entry "nodeId" must exactly match an existing node id
  R6. "hot" nodes must not exceed 30% of total nodes (mark only the truly critical ones)
  R7. depth_level values: 1 = foundational, 2 = intermediate, 3 = advanced/frontier
  R8. Every category must have at least 2 nodes assigned to it
  R9. "relation" must be one of the 11 values defined above — no custom values
  R10. Do not repeat the same node id in learningPath more than once
  R11. Every node row MUST have a non-empty string in the info column (index 6) per the ADDITIONAL INFO guidelines
  R12. N_cols, L_cols, LP_cols must appear EXACTLY as specified above — column ORDER is fixed and positional
  R13. Do not output N_cols / L_cols / LP_cols as standalone arrays with just key names — they must be followed by their data arrays N / L / LP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OUTPUT NCF SCHEMA (follow exactly):

${SCHEMA_DISPLAY}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEFORE YOU OUTPUT: Ask yourself:
  ✦ Does this map feel like how an expert THINKS about this topic, or like a Wikipedia outline?
  ✦ Are the cross-domain bridges genuinely surprising and insightful?
  ✦ Would a beginner be able to trace the learning path and feel it was the right order?
  ✦ Do the node descriptions create mental hooks, or just define terms?
  ✦ Does every link have a reason to exist, or are some just there to fill space?

If any answer is "no" — revise before outputting.

NOW OUTPUT THE NCF JSON FOR: ${topic} at ${depth} depth. Remember: columnar arrays only, _ncf field required, no verbose key-per-row objects in N/L/LP.`;
}

export function buildSkeletonPrompt(topic, depth) {
  // Take the full prompt and inject a SKELETON MODE header before the final line
  const base = buildPrompt(topic, depth);
  const insertBefore = 'NOW OUTPUT THE NCF JSON FOR:';
  const skeletonMode = `GENERATION MODE: SKELETON ONLY (Part 1 of 3)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COGNITIVE BUDGET STRATEGY — READ BEFORE GENERATING:

  This is a 3-part generation. You are doing Part 1: STRUCTURE ONLY.

  OUTPUT THE COMPLETE SKELETON:
  → All node rows: id, label, cat, hot, dl, prereq — COMPLETE
  → desc column: write the 1-sentence mentor-style description for every node
  → info column: output exactly "" (empty string) — content comes in Parts 2 & 3
  → analogy column: output null
  → All links: complete
  → Full learning path: complete (order, phase, reason, estimatedMinutes, keyInsight)
  → Categories and metadata: complete

  Writing "" for info is CORRECT in Part 1. It is NOT a rule violation.
  R11 is suspended for Part 1 only — info will be filled via enrichment prompts.

  WHY THIS ARCHITECTURE WORKS:
  → You can focus entirely on semantic topology — get every distance and link perfect
  → You will never run out of tokens before completing all nodes
  → The app renders the graph immediately from the skeleton

  CRITICAL: Do NOT skip nodes. Do NOT truncate the node list early. The skeleton
  must contain 100% of the nodes you plan. Completeness here > everything else.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  return base.replace(insertBefore, skeletonMode + insertBefore);
}

export function buildEnrichPrompt(topic, depth, skeletonData, batchNum) {
  // Sort nodes by learning path order for coherent batching
  const lpOrder = new Map(skeletonData.learningPath.map(s => [s.nodeId, s.order]));
  const sorted = [...skeletonData.nodes].sort((a, b) =>
    (lpOrder.get(a.id) ?? 999) - (lpOrder.get(b.id) ?? 999)
  );
  const mid = Math.ceil(sorted.length / 2);
  const thisBatch = batchNum === 1 ? sorted.slice(0, mid) : sorted.slice(mid);
  const otherBatch = batchNum === 1 ? sorted.slice(mid) : sorted.slice(0, mid);

  // Compact full node list (context, ~50 chars per node)
  const allNodesList = skeletonData.nodes
    .map(n => `  ${n.id} | "${n.label}" | ${n.category}`)
    .join('\n');

  // Nodes to enrich — include their links for context
  const batchDetail = thisBatch.map(n => {
    const links = skeletonData.links.filter(l => l.source === n.id || l.target === n.id);
    const linkSummary = links.slice(0,4).map(l =>
      `    ${l.relation}: ${l.source === n.id ? '→ '+l.target : l.source+' →'} (${l.label||''})`
    ).join('\n');
    return `  NODE: ${n.id} | "${n.label}" | prereqs: [${(n.prerequisites||[]).join(', ')}]\n${linkSummary}`;
  }).join('\n\n');

  const otherList = otherBatch.map(n => `  ${n.id}`).join(' · ');
  const topicSlug = topic.toLowerCase().replace(/[^a-z0-9]+/g,'_').substring(0,25);

  return `╔══════════════════════════════════════════════════════════════════════════════════╗
║           NEURON — CONTENT ENRICHMENT  (Part ${batchNum + 1} of 3 · Batch ${batchNum} of 2)              ║
╚══════════════════════════════════════════════════════════════════════════════════╝

TOPIC:  ${topic}
DEPTH:  ${depth}
BATCH:  ${batchNum} of 2 — enriching ${thisBatch.length} of ${sorted.length} nodes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CONTEXT — THE FULL MAP YOU PLANNED IN PART 1:

All ${skeletonData.nodes.length} nodes (for cross-referencing — name them in your prose):
${allNodesList}

Nodes being enriched in the OTHER batch (do NOT include these in your output):
${otherList}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOUR TASK: Write rich content for these ${thisBatch.length} nodes.

NODES TO ENRICH (with their links for context):
${batchDetail}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HOW TO WRITE desc (1 sentence):
  Mentor-style. Answer: "Why does THIS matter in the context of ${topic}?"
  Create a MENTAL HOOK, not a dictionary definition.

HOW TO WRITE info (${depth === 'researcher' ? '6-10+ paragraphs' : '4-6 paragraphs'}):
  1. Explain what it is, why it matters — include an example or analogy
  2. Reference SPECIFIC connected nodes by their label and explain WHY they connect
     (you have the full node list above — use it)
  3. Show how this node serves the bigger picture of "${topic}"
  Write as an expert mentor. Reveal surprising connections. Continuous prose, no bullets.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OUTPUT FORMAT — NCE (Neuron Content Enrichment):

  Output ONLY valid JSON. No prose. No markdown fences. Start with { end with }

  {
    "_nce": "1",
    "_id": "${topicSlug}_${depth}",
    "batch": ${batchNum},
    "E_cols": ["ni","desc","info","analogy"],
    "E": [
      ["node_id", "1-sentence desc", "full info paragraphs", "analogy string or null"],
      ... one row per node in this batch ...
    ]
  }

RULES:
  E1. Include EXACTLY the ${thisBatch.length} nodes listed above — no more, no less
  E2. Every ni must exactly match the node id from Part 1
  E3. info must be non-empty — write full depth content per guidelines above
  E4. Output ONLY the NCE JSON

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NOW WRITE THE NCE FOR BATCH ${batchNum}: ${thisBatch.length} nodes, full ${depth} depth content.`;
}
