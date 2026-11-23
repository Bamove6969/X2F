/**
 * DEMO ONLY: `npm run demo:reply <comment id> "<text>"`. The lead's reply to a comment on the demo.
 * It writes to the replies file on this machine; there is deliberately no HTTP route for this, so
 * nothing on the tailnet can post as the lead. The open page shows it within 15 seconds.
 */
import { appendReply, notesFiles, ReplyError } from './notes-server.js';

const [id, ...words] = process.argv.slice(2);
if (id === undefined || words.length === 0) {
  console.error('usage: npm run demo:reply <comment id> "<text>"');
  process.exit(2);
}
appendReply(notesFiles(process.env), id, words.join(' ')).then(
  (r) => console.log(`replied (${r.id}) on ${r.noteId}`),
  (e: unknown) => {
    console.error(e instanceof ReplyError ? e.message : `failed: ${(e as Error).message}`);
    process.exit(1);
  },
);
