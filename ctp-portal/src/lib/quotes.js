// Short, genuine quotes shown on days with no time tracked yet — a nod to the
// same touch Harvest has on empty timesheets. Kept deliberately un-corporate.
export const QUOTES = [
  { text: 'It is good to have an end to journey toward; but it is the journey that matters, in the end.', author: 'Ursula K. Le Guin' },
  { text: 'You can’t use up creativity. The more you use, the more you have.', author: 'Maya Angelou' },
  { text: 'The way to get started is to quit talking and begin doing.', author: 'Walt Disney' },
  { text: 'Amateurs sit and wait for inspiration, the rest of us just get up and go to work.', author: 'Stephen King' },
  { text: 'It always seems impossible until it’s done.', author: 'Nelson Mandela' },
  { text: 'Start where you are. Use what you have. Do what you can.', author: 'Arthur Ashe' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { text: 'Nothing is less productive than to make more efficient what should not be done at all.', author: 'Peter Drucker' },
  { text: 'Focus on being productive instead of busy.', author: 'Tim Ferriss' },
  { text: 'Do the hard jobs first. The easy jobs will take care of themselves.', author: 'Dale Carnegie' },
  { text: 'Either you run the day or the day runs you.', author: 'Jim Rohn' },
  { text: 'You will never find time for anything. If you want time, you must make it.', author: 'Charles Buxton' },
  { text: 'The future depends on what you do today.', author: 'Mahatma Gandhi' },
  { text: 'Small deeds done are better than great deeds planned.', author: 'Peter Marshall' },
  { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'Ordinary things done consistently create extraordinary results.', author: 'Keith Cunningham' },
  { text: 'Rest when you’re weary. Refresh and renew yourself. Then get back to work.', author: 'Ralph Marston' },
];

// Deterministic per day so a given empty day always shows the same quote, but
// different days rotate through the set.
export function quoteForDate(dateStr) {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) >>> 0;
  return QUOTES[h % QUOTES.length];
}
