// How many AI responses each depth needs, and what each one is.
// Larger maps are split so every response stays within a free model's output-token limit:
//   explorer      1 response:  one complete NCF map
//   practitioner  2 responses: NCF skeleton (explanations empty) + one NCE data part for all concepts
//   researcher    3 responses: NCF skeleton + two NCE data parts (concepts split in half)
// The skeleton and data formats are the historical Researcher ones; only the number of data
// parts differs.

export const MODES = Object.freeze({
  explorer: Object.freeze({ parts: 1, batches: 0, labels: Object.freeze(['Map JSON']), progressive: false }),
  practitioner: Object.freeze({ parts: 2, batches: 1, labels: Object.freeze(['Skeleton', 'Data Part']), progressive: true }),
  researcher: Object.freeze({ parts: 3, batches: 2, labels: Object.freeze(['Skeleton', 'Data Part 1', 'Data Part 2']), progressive: true }),
});

/** The mode for a depth; unknown depths behave like Explorer (one complete map). */
export const modeFor = (depth) => MODES[depth] || MODES.explorer;
