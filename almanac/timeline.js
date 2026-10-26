// Year timeline shared by the fruit and festival pages: a day-of-year slider (1 to 365) with month
// ticks, a today marker, an optional band for travel dates, and play/pause.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTH_START = MONTH_DAYS.reduce((acc, _d, i) => (acc.push(i ? acc[i - 1] + MONTH_DAYS[i - 1] : 1), acc), []);

export function dayToMonthDay(day) {
  let m = 12;
  while (m > 1 && MONTH_START[m - 1] > day) m--;
  return [m, day - MONTH_START[m - 1] + 1];
}
export const fmtDayOfYear = (day, long = true) => {
  const [m, d] = dayToMonthDay(day);
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${d}`;
};
export const monthName = (m, long = false) => (long ? MONTHS_LONG : MONTHS)[m - 1];
export const pct = (day) => `${((day - 1) / 364) * 100}%`;

// Contiguous runs of days, so a band across New Year draws as two pieces.
export function dayRuns(days) {
  const set = new Set(days);
  const runs = [];
  for (let d = 1; d <= 365; d++) {
    if (!set.has(d) || set.has(d - 1)) continue;
    let e = d;
    while (set.has(e + 1)) e++;
    runs.push([d, e]);
  }
  return runs;
}

export function createTimeline({ input, axis, marks, playBtn, daysPerSecond = 24, reducedMotion = false, onChange, label = fmtDayOfYear }) {
  input.min = '1';
  input.max = '365';
  input.step = '1';
  axis.innerHTML = MONTHS.map((m, i) => `<span style="left:${pct(MONTH_START[i] + MONTH_DAYS[i] / 2)}">${m[0]}<span class="rest">${m.slice(1)}</span></span>`).join('');
  let day = 1;
  let playing = false;
  let raf = 0;
  let timer = 0;
  let last = 0;
  let frac = 0;

  function set(d, { emit = true } = {}) {
    day = Math.min(365, Math.max(1, Math.round(d)));
    input.value = String(day);
    input.setAttribute('aria-valuetext', label(day));
    if (emit) onChange(day);
  }
  input.addEventListener('input', () => { pause(); set(Number(input.value)); });

  function frame(t) {
    if (!playing) return;
    const dt = last ? (t - last) / 1000 : 0;
    last = t;
    frac += dt * daysPerSecond;
    if (frac >= 1) {
      const step = Math.floor(frac);
      frac -= step;
      set(day + step > 365 ? 1 : day + step);
    }
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (playing) return;
    playing = true;
    playBtn.setAttribute('aria-pressed', 'true');
    playBtn.setAttribute('aria-label', 'Pause');
    if (reducedMotion) {
      // Discrete half-month steps instead of continuous movement.
      timer = setInterval(() => set(day + 15 > 365 ? 1 : day + 15), 900);
    } else {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  function pause() {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(raf);
    clearInterval(timer);
    playBtn.setAttribute('aria-pressed', 'false');
    playBtn.setAttribute('aria-label', 'Play');
  }
  playBtn.addEventListener('click', () => (playing ? pause() : play()));

  function setBand(days) {
    marks.querySelectorAll('.tl-band').forEach((el) => el.remove());
    for (const [a, b] of dayRuns(days || [])) {
      const el = document.createElement('i');
      el.className = 'tl-band';
      el.style.left = pct(a);
      el.style.width = `calc(${pct(b)} - ${pct(a)} + 3px)`;
      marks.appendChild(el);
    }
  }
  function setToday(d) {
    let el = marks.querySelector('.tl-today');
    if (!el) {
      el = document.createElement('i');
      el.className = 'tl-today';
      el.title = 'Today';
      marks.appendChild(el);
    }
    el.style.left = pct(d);
  }
  return { set, get: () => day, play, pause, setBand, setToday };
}
