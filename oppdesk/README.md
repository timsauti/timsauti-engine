# Timsauti Opportunity Desk

Finds paid training and consultancy work every morning and drafts your first response.

## What it does each day
1. From 6am it reads the sources listed in `sources.json`: the government tenders portal, UNDP and UN Kenya notices, KTDA and Amref tenders, Kenyan consultancy boards and news of new terms of reference.
2. It drops what it has shown you before, old notices, salaried jobs, supplies and works, and anything outside your kind of work.
3. The AI scores what is left against `profile.json` and decides who should bid: Timsauti Ltd for firms, Timothy Muli Makasa for individual consultants and facilitators.
4. It opens each strong match and reads the deadline and requirements from the notice itself. A deadline is marked "read on the notice itself" only when those words are on the page.
5. You get the best ones (six at most) on Telegram, each with two buttons: Draft my response, and Not for me. On a quiet day it says so in one line.

## Drafts
Tap Draft my response and the draft arrives within the hour: the letter, what to attach, and an honest list of gaps (things the notice asks for that your profile does not show). The letter uses only what is in `profile.json`. Anything it cannot know, such as your fee, is left in [square brackets] for you to fill.

## Opportunities you find yourself, including on LinkedIn
The agent does not read LinkedIn. When you see something there or anywhere else, send it to the Telegram bot as a message starting with `Opp:` followed by the link or the pasted text. It is assessed the same way and you can ask for a draft.

## Reminders
For every opportunity you asked a draft for, you are reminded three days before the deadline and the day before.

## Keeping it true
- `profile.json` is who you are for bidding purposes. When you finish a new assignment or gain a credential, add it there. The agent never claims what is not written in that file.
- `sources.json` is where it looks. A source that stops answering for a week is reported to you.
- The fit score is the AI's judgment and can be wrong. Always read the full notice before you send anything.

## Checking it by hand
On GitHub: Actions, "Opportunity Desk check", Run workflow. Mode `dry` prints the whole morning search in the run's log and sends nothing. Mode `probe` only tests the sources.

## The free AI allowance
The desk uses about 10 AI requests a day. If the main allowance is used up by the news Pages, the search tries again each hour, up to six times. A separate free key saved as the secret `GEMINI_OPPDESK_KEY` gives the desk its own allowance.
