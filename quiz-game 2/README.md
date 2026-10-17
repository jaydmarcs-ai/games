# Guess the Quiz (Netlify)

Live quiz for events: 100 questions in 4 rounds, one phone per team, and a host/projector screen.
The pages are static files; the game runs as a Netlify Function with the live state kept in Netlify Blobs.
Screens ask for updates about once a second (much slower during the break).

## The four rounds
1. **General knowledge** (30 questions). Every team answers every question.
2. **Claim your category** (8 categories: Sports, History, CRE, Entertainment, Science, Geography, Music, Kenya).
   Teams take turns claiming a category, lowest score first (15 seconds to choose, then a free one is assigned;
   the host can also claim for a team). A claimed category belongs to that team alone: it answers 4 of its
   questions, one after another, and no other team can answer them (their phones show a watch screen).
   Only the owning team scores on its questions. With 8 teams that is 32 questions; with fewer teams,
   fewer categories are used. Change the 4 with `perTeam` on round 2 in `questions/quiz.json`.
   **A 30 minute break follows this round.**
3. **Guess the logo** (20 questions). A logo is shown, teams pick the brand.
4. **Guess the face** (18 questions). Only part of a face is shown (the eyes, the smile, or half the face),
   teams pick the Kenyan comedian, and the full photo appears with the answer.

Between rounds the projector shows the standings and what each team gained that round.

## The break
After round 2 the projector and every phone show a 30:00 countdown. Nothing starts by itself when it hits zero:
the host presses "Start round 3". The host bar also has "Add 5 minutes". During the break phones download
the round 3 images, so the first logo appears instantly. Change the break in `questions/quiz.json`
(`breakAfterMinutes` on round 2, or add it to any other round).

## Deploy
1. Put this folder in a Git repo and connect it to Netlify (or run `npm install` then `netlify deploy --prod`).
2. In Netlify: Site configuration > Environment variables, add `ADMIN_PIN` (required, the host's PIN) and
   optionally `ADMIN_NAME` (defaults to Ibrahim). Redeploy after adding them.
3. Host / projector: `https://YOUR-SITE.netlify.app/host`. Teams: `https://YOUR-SITE.netlify.app`.

## Adding the logo and face images (needed before rounds 3 and 4)
The game ships with numbered placeholder images so you can rehearse. Replace them by adding your own
files with these exact names (png, jpg, jpeg, webp or svg all work). Any file you add wins over the placeholder.
Logos on a transparent background work well. For faces, upload a normal portrait (head and shoulders, face
roughly in the middle, upright): the game does the cropping itself. Keep each file under about 300 KB.
The numbers are deliberate: the file name never gives the answer away.

**Round 3: `public/img/logos/`**

| File | Brand | Save as |
|---|---|---|
| 01 | Safaricom | `public/img/logos/01.png` |
| 02 | M-Pesa | `public/img/logos/02.png` |
| 03 | Nike | `public/img/logos/03.png` |
| 04 | Adidas | `public/img/logos/04.png` |
| 05 | Coca-Cola | `public/img/logos/05.png` |
| 06 | KFC | `public/img/logos/06.png` |
| 07 | McDonald's | `public/img/logos/07.png` |
| 08 | Apple | `public/img/logos/08.png` |
| 09 | Samsung | `public/img/logos/09.png` |
| 10 | Google | `public/img/logos/10.png` |
| 11 | Netflix | `public/img/logos/11.png` |
| 12 | Spotify | `public/img/logos/12.png` |
| 13 | Tusker | `public/img/logos/13.png` |
| 14 | Kenya Airways | `public/img/logos/14.png` |
| 15 | Equity Bank | `public/img/logos/15.png` |
| 16 | Naivas | `public/img/logos/16.png` |
| 17 | Java House | `public/img/logos/17.png` |
| 18 | Toyota | `public/img/logos/18.png` |
| 19 | Instagram | `public/img/logos/19.png` |
| 20 | WhatsApp | `public/img/logos/20.png` |

**Partial faces (round 4).** Each face question has a `crop` in `questions/quiz.json`, rotating through four
styles: `eyes`, `smile`, `half-left` and `half-right`. The full photo shows on the answer screen. To change one,
edit that item's `"crop"`. Delete the `"crop"` to show the whole face. For a custom crop use a region given as
fractions of the picture, for example `"crop": {"x": 0.2, "y": 0.3, "w": 0.6, "h": 0.2}` (x and y are the top-left
corner, w and h the size). If a photo is framed differently (face very low, or off to one side), a custom region
fixes it. Note: a very determined player could still open the full photo with browser tools. That is fine for a
friendly event; if you need it airtight, crop the photos yourself before uploading.

**Round 4: `public/img/faces/`**

| File | Comedian | Save as |
|---|---|---|
| 01 | Churchill | `public/img/faces/01.png` |
| 02 | Eric Omondi | `public/img/faces/02.png` |
| 03 | Njugush | `public/img/faces/03.png` |
| 04 | Mulamwah | `public/img/faces/04.png` |
| 05 | Jalang'o | `public/img/faces/05.png` |
| 06 | Eddie Butita | `public/img/faces/06.png` |
| 07 | Crazy Kennar | `public/img/faces/07.png` |
| 08 | Chipukeezy | `public/img/faces/08.png` |
| 09 | Mammito | `public/img/faces/09.png` |
| 10 | Terence Creative | `public/img/faces/10.png` |
| 11 | Akuku Danger | `public/img/faces/11.png` |
| 12 | DJ Shiti | `public/img/faces/12.png` |
| 13 | Sleepy David | `public/img/faces/13.png` |
| 14 | Oga Obinna | `public/img/faces/14.png` |
| 15 | Dr Ofweneke | `public/img/faces/15.png` |
| 16 | Philip Karanja | `public/img/faces/16.png` |
| 17 | Awinja | `public/img/faces/17.png` |
| 18 | Nyambane | `public/img/faces/18.png` |

Want a different brand or comedian? Edit `questions/quiz.json`: change the `answer` of that item. Wrong options
are picked automatically from the other names in the round (brands also use the `pool` list, grouped by kind,
so sportswear is mixed with sportswear). Only keep comedians you have photos for.

## Other rules
- Up to 8 teams, up to 4 members each. The team's phone enters the team name and the member names.
- The host can start with any number of teams (at least 1). After the start, no new teams can join.
- Before tapping an answer, the phone picks which member is answering (it starts on whoever has answered
  the fewest times). The first tap locks in the team's answer. The projector shows who answered.
- A question closes after its time limit (20s, or 15s in the picture rounds), or once every team has answered.
- Score: 10 points for a correct answer plus up to 5 speed bonus (shrinks as the clock runs down).
- Ties: the team with the faster total time on correct answers wins. If still level, teams share the title.
- If a team's phone dies, a new phone types the exact team name and confirms to take over.
- The final leaderboard stays up until the host picks "Play again" or "Clear teams".

## Host controls (bottom bar)
Start game, Close question now, Next question, Finish round, Start round N, Add 5 minutes, Pick (for the team
choosing), End game, Play again with the same teams, Clear teams and start over. In the lobby, "Remove" kicks a team.

## Your own questions
Edit `questions/quiz.json`, then redeploy. A text question is
`{ "text": "...", "options": ["A", "B", "C", "D"], "correct": 1 }` where `correct` counts from 0.
Add `"seconds": 30` to give one question more time.

## Test without Netlify
`npm test` plays a full simulated 100-question game against the same server code (53 checks).

## Cost note
About one function call per second per screen while a question is open: roughly 10 per second with 8 teams
plus the host, around 36,000 an hour. During the 30 minute break it drops to about 2 per second. Change the
numbers in `pollDelay()` in `public/shared.js` to trade speed for fewer calls.
