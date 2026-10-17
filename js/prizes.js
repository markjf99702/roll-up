// The prize counter, cheapest first. Tickets come from games: one for every 10 points.
// `say` is how the counter hands it over: "You got a rubber duck."
export const PRIZES = [
  { id: 'lollipop', emoji: '🍭', name: 'Lollipop', cost: 5, say: 'a lollipop' },
  { id: 'spider-ring', emoji: '🕷️', name: 'Spider ring', cost: 10, say: 'a spider ring' },
  { id: 'balloon', emoji: '🎈', name: 'Balloon', cost: 15, say: 'a balloon' },
  { id: 'fuzzy-dice', emoji: '🎲', name: 'Fuzzy dice', cost: 25, say: 'a pair of fuzzy dice' },
  { id: 'yo-yo', emoji: '🪀', name: 'Yo-yo', cost: 40, say: 'a yo-yo' },
  { id: 'magnet', emoji: '🧲', name: 'Horseshoe magnet', cost: 50, say: 'a horseshoe magnet' },
  { id: 'duck', emoji: '🦆', name: 'Rubber duck', cost: 75, say: 'a rubber duck' },
  { id: 'shades', emoji: '🕶️', name: 'Novelty shades', cost: 100, say: 'a pair of novelty shades' },
  { id: 'dinosaur', emoji: '🦖', name: 'Toy dinosaur', cost: 150, say: 'a toy dinosaur' },
  { id: 'disc', emoji: '🥏', name: 'Flying disc', cost: 200, say: 'a flying disc' },
  { id: 'fortune-ball', emoji: '🎱', name: 'Fortune ball', cost: 300, say: 'a fortune ball' },
  { id: 'kite', emoji: '🪁', name: 'Kite', cost: 400, say: 'a kite' },
  { id: 'octopus', emoji: '🐙', name: 'Stuffed octopus', cost: 600, say: 'a stuffed octopus' },
  { id: 'flamingo', emoji: '🦩', name: 'Blow-up flamingo', cost: 900, say: 'a blow-up flamingo' },
  { id: 'bear', emoji: '🧸', name: 'Giant teddy bear', cost: 1500, say: 'a giant teddy bear' },
  { id: 'unicorn', emoji: '🦄', name: 'Enormous unicorn', cost: 2500, say: 'an enormous unicorn' },
];

export const ticketsFor = score => Math.floor(score / 10);
