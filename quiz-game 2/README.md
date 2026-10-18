# Guess the Quiz (Netlify)

Live quiz for events: 100 questions in 4 rounds, one phone per team, and a host/projector screen.
The pages are static files; the game runs as a Netlify Function with the live state kept in Netlify Blobs.
Screens ask for updates about once a second (much slower during the break).

## The four rounds
1. **General knowledge** (30 questions). Every team answers every question.
2. **Claim your category** (8 categories: Sports, History, JW, Entertainment, Science, Geography, Music, Kenya).
   A team is drawn at random and chooses a category on its phone (15 seconds, then a free one is assigned; the
   host can also choose for it). It then plays that category straight away, alone: 4 of its questions, one after
   another, and no other team can answer them (their phones show a watch screen). When it is done, the next team
   is drawn from those who have not played yet. A category that has been chosen is taken, so no other team can
   choose it. Only the team that is playing scores. With 8 teams that is 32 questions. Change the 4 with `perTeam`
   on round 2 in `questions/quiz.json`. (With more teams than categories, the extra teams do not get a turn.)
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

## Editing the questions (the easy way)
Open `https://YOUR-SITE.netlify.app/questions` (there is also a button for it in the host's lobby) and enter the admin PIN.
Nothing changes in the game until you press **Save changes**.

- **Pick a round** with the tabs. Round 1 is a list of questions; round 2 has categories, each with its own
  questions; rounds 3 and 4 are lists of pictures with the name that goes with each.
- **Edit** the wording, the answers (tap the round button next to the right one), or the seconds. **Delete** removes a
  question. **Add a question** adds a blank one: fill in 2 to 4 answers.
- **Typed-number questions:** change a question's kind to "Typed number" and enter the right answer, or leave it blank
  to type the answer live during the game. "Counts if within" accepts answers near the right one.
- **Categories:** rename, add or delete them. Each team that picks a category plays "Questions each team plays" of its
  questions (a warning appears if a category has fewer than that).
- **Pictures:** adding a picture adds a slot for it, then upload its image on the Pictures page. The wrong options
  come from the other names, plus the "extra wrong answers" list at the bottom of the round.
- **Round settings:** title, intro text, seconds per question, and the break after the round (in minutes).
- If something cannot be saved, a red message says exactly which question to fix, and nothing is changed.
- **Between games only:** while a game is running, saving is locked (End game or clear it first).
- **Download a backup** saves your questions to a file; **Load from a file** brings them back (then press Save changes).
- **Back to the original questions** throws your edits away and returns to the questions that shipped with the game.
- Once you have saved edits, they are what the game uses. A newer `questions/quiz.json` uploaded to GitHub will not
  replace them unless you press "Back to the original questions" first.

## Adding the logo and celebrity pictures (the easy way)
Open `https://YOUR-SITE.netlify.app/images` (there is also a button for it in the host's lobby) and enter the admin PIN.
The page lists all 38 pictures with the name each one must show (20 logos, 18 celebrities).

- **One at a time:** press **Choose picture** on a card and pick the file from your computer or phone.
- **Many at once:** press **Choose many pictures at once** and select all the files together. Name them by number
  (`01.jpg`, `02.png`, `logo-3.png`): each goes to the slot with that number. Files without a number are skipped
  and listed.
- Big photos are shrunk automatically. PNG, JPG, WEBP and SVG all work. A PNG logo keeps its see-through background.
- Celebrity cards show a preview of how the photo will be cropped during the question. If the face is not where
  the crop expects it, use a different photo (or set a custom crop, see below).
- **Replace** swaps a picture, **Remove** puts the grey placeholder back. Changes are live straight away, no
  redeploy needed.
- Uploaded pictures are used first. If a slot has no upload, the game falls back to a file in `public/img/` (the
  grey placeholders live there, and you can still add real files there through GitHub instead).

## Typed-number questions (the JW category)
Some questions are answered by typing a number on the team's phone, for example "How many books are in the Bible?".
In `questions/quiz.json` they look like this:

    { "type": "number", "text": "How many books are in the Bible?", "answer": 66, "seconds": 25 }

- A typed answer counts only if it matches exactly. Add `"tolerance": 10` to accept anything within 10 either way.
- Any round can use them, but they are meant for category rounds.
- **Questions with no saved answer (the Njakai numbers).** The four JW questions about Njakai have
  `"answer": null`. They are asked like any other: the team that is playing types its number. When the question
  closes, the host's screen shows what the team typed and a box in the bottom bar: type the correct number and
  press **Confirm answer**, and the points are awarded (speed bonus still counts, based on when the team answered).
  The host cannot move on until a number is entered. **No points for this one** skips scoring. The host's lobby
  lists these questions as a reminder. If you already know the number, put it in `quiz.json` in place of `null`
  (for example `"answer": 14`) and the step is skipped.
