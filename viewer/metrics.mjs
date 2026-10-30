// Character advance widths of Source Sans 3 (weight 600) at 100px, measured in Chromium with the font embedded in the viewer.
// Used at build time to size labels without a browser, so the layout is the same on every build.
export const SANS_600_AT_100 = {"0": 51.3, "1": 51.3, "2": 51.3, "3": 51.3, "4": 51.3, "5": 51.3, "6": 51.3, "7": 51.3, "8": 51.3, "9": 51.3, " ": 20, "!": 31.5, "\"": 48.2, "#": 51.3, "$": 51.3, "%": 84.1, "&": 63.9, "'": 27.5, "(": 32.4, ")": 32.4, "*": 43.8, "+": 51.3, ",": 27.5, "-": 32.2, ".": 27.5, "/": 34.4, ":": 27.5, ";": 27.5, "<": 51.3, "=": 51.3, ">": 51.3, "?": 44.4, "@": 87.5, "A": 55.8, "B": 59.7, "C": 57.6, "D": 62.5, "E": 53.8, "F": 51, "G": 62.8, "H": 66.3, "I": 28.2, "J": 49.4, "K": 59.7, "L": 50.2, "M": 74.5, "N": 65.7, "O": 67.4, "P": 58.2, "Q": 67.4, "R": 59.2, "S": 54.5, "T": 54.6, "U": 65.5, "V": 53.6, "W": 80, "X": 54.1, "Y": 50.1, "Z": 54, "[": 32.4, "\\": 34.4, "]": 32.4, "^": 51.3, "_": 50, "`": 54.9, "a": 51.6, "b": 56.3, "c": 46.2, "d": 56.4, "e": 50.7, "f": 31.7, "g": 52, "h": 55.8, "i": 26.2, "j": 26.3, "k": 52.2, "l": 27.1, "m": 84.3, "n": 56, "o": 54.9, "p": 56.4, "q": 56.4, "r": 37.3, "s": 43.1, "t": 36.1, "u": 55.6, "v": 49.5, "w": 74.8, "x": 48.1, "y": 49.5, "z": 44.3, "{": 32.4, "|": 25.5, "}": 32.4, "~": 51.3, "æ": 78, "ø": 54.9, "å": 51.6, "Æ": 83.4, "Ø": 67.4, "Å": 55.8, "é": 50.7, "è": 50.7, "ê": 50.7, "ö": 54.9, "ä": 51.6, "ü": 55.6, "Ö": 67.4, "Ä": 55.8, "Ü": 65.5, "–": 48, "—": 80, "·": 27.5, "’": 27.5, "«": 45.5, "»": 45.5, "×": 51.3, "²": 37.2, "³": 37.2, "√": 54.9, "≤": 54.9, "≥": 54.9, "≠": 54.9, "±": 51.3, "°": 34.8, "π": 54.8, "∑": 71.3, "∈": 87.1, "∩": 71.9, "∪": 73.2};

const FALLBACK = 52;
export function textWidth(text, px) {
  let w = 0;
  for (const ch of String(text)) w += SANS_600_AT_100[ch] ?? FALLBACK;
  return (w * px) / 100;
}

// Greedy word wrap, the same rule the browser uses for label text. Returns the lines and the widest line.
export function wrap(text, px, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      const trial = cur ? cur + ' ' + word : word;
      if (cur && textWidth(trial, px) > maxW) { lines.push(cur); cur = word; } else cur = trial;
    }
    lines.push(cur);
  }
  return { lines, w: Math.ceil(Math.max(...lines.map((l) => textWidth(l, px)))) };
}
