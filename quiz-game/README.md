# Guess the Quiz (Netlify)

Live quiz for events. A host/projector screen, plus one phone per team.
The pages are static files; the game itself runs as a Netlify Function, with the live game
state stored in Netlify Blobs. Screens ask for updates about once a second.

## Deploy
1. Put this folder in a Git repo and connect it to Netlify (or run `npm install` then `netlify deploy --prod`).
   Use Git or the CLI rather than drag-and-drop, because the function needs its dependency installed.
2. In Netlify: Site configuration > Environment variables, add:
   - `ADMIN_PIN`  (required) the PIN the host types to unlock the controls, e.g. 4821
   - `ADMIN_NAME` (optional) shown on screens, defaults to Ibrahim
3. Redeploy after adding the variables.

- Host / projector: `https://YOUR-SITE.netlify.app/host` (enter the PIN)
- Teams: `https://YOUR-SITE.netlify.app` (one phone per team)

## Rules as built
- Up to 8 teams, up to 4 members each. The team's phone enters the team name and the member names.
- The host can start with any number of teams (at least 1). After the start, no new teams can join.
- Before tapping an answer, the phone picks which member is answering. It starts on whoever has
  answered the fewest times, so turns rotate unless the team chooses otherwise.
- The first tap locks in the team's answer. The projector shows which member answered.
- A question closes after its time limit, or as soon as every team has answered.
- Score: 10 points for a correct answer, plus up to 5 speed bonus (shrinks as the clock runs down).
- Ties: the team with the faster total time on correct answers wins. If still level, teams share the title.
- If a team's phone dies, a new phone types the exact team name and confirms to take over.
- The final leaderboard stays up until the host picks "Play again" or "Clear teams".

## Host controls (bottom bar)
Start game, Close round now, Next question, End game, Play again with the same teams,
Clear teams and start over. In the lobby, "Remove" next to a team kicks it.

## Your own questions
Edit `questions/general_knowledge.json`, then redeploy. Each question is:
`{ "text": "...", "options": ["A", "B", "C", "D"], "correct": 1, "seconds": 15 }`
`correct` is the position of the right option, counting from 0. `seconds` is optional (default 20).

## Test without Netlify
`npm test` runs a full simulated game against the same server code.

## Cost note
Every screen asks the function for an update about once a second while a question is open
(a bit slower in the lobby and at the end). With 8 team phones plus the host that is roughly
10 calls per second, about 36,000 an hour. Change the numbers in `pollDelay()` in `public/shared.js`
if you want fewer calls.
