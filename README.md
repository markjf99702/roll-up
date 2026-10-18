# Roll Up

**Play it: [roll-up.junkdrawer.works](https://roll-up.junkdrawer.works/)**

**Skee-ball on your phone, the boardwalk kind.** Flick the ball up the lane, and it hops the ramp and drops into a ring worth 10 to 50, or a 100 up in the corners. A game is nine balls, one of them golden, every 10 points wins a ticket, and the tickets pile up for the prize counter. Today's card calls nine shots, the same for everyone that day.

<p align="center">
  <img src="docs/phone-lane.png" alt="Today's card on ball 4 of 9: the golden ball waits behind the line on the maple lane, both 100 cups glow teal at the far end, and notes over the lane say the 100 is called and this is the golden ball" width="250">
  &nbsp;
  <img src="docs/phone-board.png" alt="Pushed in on the board as a ball drops into the 50 cup: chrome rings on a blue board with lit numbers 20, 30, 40 and 50 down the middle, 100 cups in both top corners, and +50 rising over the cup" width="250">
</p>
<p align="center">
  <img src="docs/phone-card.png" alt="The end of today's card: 880 points, a chip for each ball with stars on the eight called shots and the golden ball's 400 in gold, and a strip of 88 orange tickets hanging out of a slot" width="250">
  &nbsp;
  <img src="docs/phone-prizes.png" alt="The prize counter with 214 tickets: a shelf holding two lollipops, a spider ring, a rubber duck and a toy dinosaur, above a grid of prizes from a 5-ticket lollipop up" width="250">
</p>

## How it plays

- **Drag, then flick.** Put a finger on the lane and the ball moves with it, so you can line it up anywhere across. Flick up the lane to roll; a slow drag just moves it.
- **How hard decides where it lands.** A gentle roll drops into the 20, firmer climbs to the 30, 40 and 50, and too hard sails over the rings into the 10. Too gentle and it doesn't make the jump at all, which scores nothing.
- **The 100s want an angle.** They sit in the top corners: roll firmly and a little toward one.
- **Real bounces.** The ball is simulated in 3D, so it rattles off the ring lips and can bounce out of a ring or into a better one.
- **The golden ball.** One ball in every game is golden, and whatever it drops into scores double. You can see which one it is in the tray.
- **Today's card.** Nine called shots, the same for everyone that day, with that day's golden ball. The called hole glows; drop the ball in it for double, so a called shot with the golden ball is ×4. You get one go a day, a star for each call you hit, a count of the days in a row you've played, and a line to send someone. A new card comes at midnight.
- **Tickets and prizes.** Every 10 points is a ticket, and they feed out of a slot at the end of each game. Spend them at the prize counter, from a lollipop to an enormous unicorn, and they sit on your shelf.
- **The keyboard works too.** ← and → move the ball; hold Space to wind up and let go to roll.
- No account and no server. Your tickets, prizes and best score stay in your browser. It works offline and installs to a phone's home screen.

## Running it

It's a static site: plain HTML, CSS and JavaScript, with no build step.

```sh
npx serve .                   # or any static file server, then open the printed address
npm test                      # the physics and scoring in node, then games in Chromium through the real page (needs Playwright)
node tools/screenshots.mjs    # redraws docs/*.png and og.png
node tools/make-icons.mjs     # redraws the PNG icons from icon.svg
npm run build                 # optional: the whole game as one file, dist/roll-up.html
```

To put it online with GitHub Pages: **Settings → Pages → Build and deployment → Deploy from a branch**, then pick `main` and `/ (root)`. The `CNAME` file serves it at roll-up.junkdrawer.works.

### Files

- `js/physics.js`: the machine's measurements in centimetres, and the ball rolling, jumping, bouncing off lips and dropping into holes. No browser needed, so the tests run it in node.
- `js/scene.js`: draws the machine in perspective on a canvas, pushes in on the board while the ball is up there, and turns a finger on the screen into a spot on the lane.
- `js/app.js`: the game: turns, the flick, the score, tickets and the prize counter.
- `js/sound.js`: every sound, made with Web Audio on the spot.
- `js/prizes.js`: what's at the prize counter and what it costs.
- `js/daily.js`: today's card, drawn from the date so every phone gets the same one, and how called shots and the golden ball score.
- `test/unit.test.mjs`: which ring a roll lands in, that every roll ends, that the holes fit their rings, and today's card.
- `test/e2e.mjs`: plays a game in Chromium with a real mouse flick and a day's card, then checks the golden ball, the tickets, sharing, the prize counter, a reload and offline.
- `fonts/`: Bungee and Figtree (SIL Open Font License), served from here so nothing loads from elsewhere.
- `sw.js`: keeps a copy for playing offline.
