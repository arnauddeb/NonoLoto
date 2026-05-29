const state = {
  draws: [],
  current: null,
};

const elements = {
  predictorCard: document.querySelector("#predictorCard"),
  mainNumbers: document.querySelector("#mainNumbers"),
  chanceNumber: document.querySelector("#chanceNumber"),
  drawCount: document.querySelector("#drawCount"),
  databaseStatus: document.querySelector("#databaseStatus"),
  predictionTitle: document.querySelector("#predictionTitle"),
  predictionSummary: document.querySelector("#predictionSummary"),
  reasonsList: document.querySelector("#reasonsList"),
  windowSelect: document.querySelector("#windowSelect"),
  modeSelect: document.querySelector("#modeSelect"),
  windowHelp: document.querySelector("#windowHelp"),
  modeHelp: document.querySelector("#modeHelp"),
  generateButton: document.querySelector("#generateButton"),
  packButton: document.querySelector("#packButton"),
  packPanel: document.querySelector("#packPanel"),
  packList: document.querySelector("#packList"),
  optionsPanel: document.querySelector("#optionsPanel"),
  latestDrawDate: document.querySelector("#latestDrawDate"),
  historyList: document.querySelector("#historyList"),
};

const BUTTON_IDLE = "Révéler le pronostic";
const BUTTON_BUSY = "Les boules tournent...";

const modeCopy = {
  balanced: {
    label: "Pronostic principal",
    help: "Le réglage conseillé : hasard majoritaire, avec une légère lecture des tendances FDJ pour départager les grilles.",
    reason: "Cette grille est le meilleur score calculé sur la base analysée.",
  },
  history: {
    label: "100% historique",
    help: "Mode radical : Nono prend la grille qui obtient le meilleur score sur l'historique FDJ, sans variante aléatoire.",
    reason: "Cette proposition correspond au meilleur score historique calculé.",
  },
  hot: {
    label: "Numéros réguliers",
    help: "La grille augmente légèrement les numéros souvent présents, sans oublier que chaque tirage reste indépendant.",
    reason: "Cette proposition privilégie les numéros les plus réguliers de la période.",
  },
  overdue: {
    label: "Numéros à surveiller",
    help: "La grille surveille les numéros absents depuis plusieurs tirages, avec une pondération volontairement prudente.",
    reason: "Cette proposition met davantage en avant les numéros peu sortis récemment.",
  },
};

const windowCopy = {
  50: "Analyse uniquement les tirages très récents. Les propositions évoluent plus vite.",
  100: "Le choix conseillé : assez récent, mais suffisamment stable.",
  250: "Analyse une période plus large. Les propositions sont plus régulières.",
  all: "Analyse toute l'archive récente disponible.",
};

const FDJ_HISTORY_ZIP_URL =
  "https://www.sto.api.fdj.fr/anonymous/service-draw-info/v3/documentations/1a2b3c4d-9876-4562-b3fc-2c963f66afp6";

async function init() {
  const csv = await loadDraws();
  state.draws = parseCsv(csv);
  updateOptionHelp();
  generate();
}

async function loadDraws() {
  try {
    const response = await fetch(FDJ_HISTORY_ZIP_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`FDJ ${response.status}`);
    return await unzipCsv(await response.arrayBuffer());
  } catch (error) {
    console.info("Lecture FDJ en ligne impossible.", error);
    throw new Error("Impossible de charger la base FDJ en ligne. Vérifiez la connexion, puis rechargez l'app.");
  }
}

async function unzipCsv(buffer) {
  const bytes = new Uint8Array(buffer);
  if (window.fflate) {
    const files = window.fflate.unzipSync(bytes);
    const csvName = Object.keys(files).find((name) => name.endsWith(".csv"));
    if (!csvName) throw new Error("CSV introuvable dans l'archive FDJ.");
    return new TextDecoder().decode(files[csvName]);
  }

  const view = new DataView(buffer);
  const directoryOffset = findCentralDirectory(view);
  let offset = directoryOffset;

  while (offset < bytes.length && view.getUint32(offset, true) === 0x02014b50) {
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const fileName = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength));

    if (fileName.endsWith(".csv")) {
      return readZipEntry(view, bytes, localHeaderOffset, compressedSize, method);
    }

    offset = nameStart + nameLength + extraLength + commentLength;
  }

  throw new Error("CSV introuvable dans l'archive FDJ.");
}

function findCentralDirectory(view) {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return view.getUint32(offset + 16, true);
    }
  }
  throw new Error("Archive FDJ illisible.");
}

async function readZipEntry(view, bytes, localHeaderOffset, compressedSize, method) {
  if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
    throw new Error("Archive FDJ invalide.");
  }

  const nameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(dataStart, dataStart + compressedSize);

  if (method === 0) return new TextDecoder().decode(compressed);
  if (method !== 8) throw new Error("Compression FDJ non supportée.");
  if (!("DecompressionStream" in window)) throw new Error("Navigateur trop ancien pour lire l'archive FDJ.");

  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(inflated);
}

function parseCsv(csv) {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const headers = headerLine.split(";");

  return lines
    .map((line) => {
      const cells = line.split(";");
      const row = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
      const numbers = [1, 2, 3, 4, 5]
        .map((index) => Number(row[`boule_${index}`]))
        .filter(Boolean)
        .sort((a, b) => a - b);

      return {
        id: row.annee_numero_de_tirage,
        day: row.jour_de_tirage.trim(),
        date: row.date_de_tirage,
        timestamp: parseFrenchDate(row.date_de_tirage).getTime(),
        numbers,
        chance: Number(row.numero_chance),
      };
    })
    .filter((draw) => draw.numbers.length === 5 && draw.chance)
    .sort((a, b) => b.timestamp - a.timestamp);
}

function parseFrenchDate(value) {
  const [day, month, year] = value.split("/").map(Number);
  return new Date(year, month - 1, day);
}

function formatFrenchDate(date) {
  const formatted = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);

  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function nextDrawDateFromLatest(draw) {
  const drawDays = new Set([1, 3, 6]);
  const next = new Date(draw.timestamp);
  next.setDate(next.getDate() + 1);

  while (!drawDays.has(next.getDay())) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function activeDraws() {
  const size = elements.windowSelect.value;
  return size === "all" ? state.draws : state.draws.slice(0, Number(size));
}

function generate() {
  const prediction = createPrediction();
  state.current = prediction;
  renderPrediction();
  if (!elements.packPanel.hidden) renderPack();
}

function createPrediction() {
  const sample = activeDraws();
  const mode = elements.modeSelect.value;
  const stats = buildStats(sample);
  const result = chooseNumbers(stats, mode);
  const numbers = result.numbers;
  const chanceResult = chooseChance(stats, mode);
  const chance = chanceResult.number;

  return { numbers, chance, stats, mode, sample, diagnostics: { ...result.diagnostics, chanceRank: chanceResult.rank } };
}

async function revealPrediction() {
  if (!state.draws.length || elements.generateButton.disabled) return;

  const prediction = createPrediction();
  triggerVibration();
  elements.generateButton.disabled = true;
  elements.generateButton.textContent = BUTTON_BUSY;
  elements.predictorCard.classList.add("is-revealing");
  elements.mainNumbers.classList.add("is-shuffling");
  elements.chanceNumber.parentElement.classList.add("is-shuffling");
  elements.predictionSummary.textContent = "Les boules tournent...";
  elements.chanceNumber.classList.remove("is-revealing");
  elements.chanceNumber.style.removeProperty("--delay");
  elements.mainNumbers.innerHTML = [0, 1, 2, 3, 4]
    .map(() => `<span class="ball is-placeholder">?</span>`)
    .join("");
  elements.chanceNumber.textContent = "?";
  elements.chanceNumber.classList.add("is-placeholder");

  await delay(720);
  state.current = prediction;
  renderPrediction({ animate: true });
  if (!elements.packPanel.hidden) renderPack();

  await delay(980);
  elements.generateButton.disabled = false;
  elements.generateButton.textContent = BUTTON_IDLE;
  elements.predictorCard.classList.remove("is-revealing");
}

function buildStats(draws) {
  const numberFrequency = seededMap(49);
  const recentFrequency = seededMap(49);
  const chanceFrequency = seededMap(10);
  const lastSeen = seededMap(49, draws.length);
  const chanceLastSeen = seededMap(10, draws.length);
  const pairFrequency = new Map();
  const recentWindow = draws.slice(0, Math.min(30, draws.length));

  draws.forEach((draw, drawIndex) => {
    draw.numbers.forEach((number) => {
      numberFrequency.set(number, numberFrequency.get(number) + 1);
      if (lastSeen.get(number) === draws.length) lastSeen.set(number, drawIndex);
    });

    chanceFrequency.set(draw.chance, chanceFrequency.get(draw.chance) + 1);
    if (chanceLastSeen.get(draw.chance) === draws.length) chanceLastSeen.set(draw.chance, drawIndex);

    for (let i = 0; i < draw.numbers.length; i += 1) {
      for (let j = i + 1; j < draw.numbers.length; j += 1) {
        const key = pairKey(draw.numbers[i], draw.numbers[j]);
        pairFrequency.set(key, (pairFrequency.get(key) || 0) + 1);
      }
    }
  });

  recentWindow.forEach((draw) => {
    draw.numbers.forEach((number) => {
      recentFrequency.set(number, recentFrequency.get(number) + 1);
    });
  });

  const averageSum = Math.round(
    draws.reduce((sum, draw) => sum + draw.numbers.reduce((a, b) => a + b, 0), 0) / draws.length
  );

  const numberScores = new Map();
  const historyScores = new Map();
  for (let number = 1; number <= 49; number += 1) {
    numberScores.set(number, scoreNumber(number, numberFrequency, recentFrequency, lastSeen, draws.length, recentWindow.length));
    historyScores.set(number, scoreNumberHistory(number, numberFrequency, recentFrequency, lastSeen, draws.length, recentWindow.length));
  }

  return {
    drawCount: draws.length,
    recentCount: recentWindow.length,
    numberFrequency,
    recentFrequency,
    chanceFrequency,
    lastSeen,
    chanceLastSeen,
    pairFrequency,
    numberScores,
    historyScores,
    averageSum,
  };
}

function seededMap(max, value = 0) {
  const map = new Map();
  for (let i = 1; i <= max; i += 1) map.set(i, value);
  return map;
}

function scoreNumber(number, frequencies, recentFrequencies, lastSeen, drawCount, recentCount) {
  const globalRatio = bayesianRatio(frequencies.get(number), drawCount * 5, 49, 4);
  const recentRatio = bayesianRatio(recentFrequencies.get(number), recentCount * 5, 49, 8);
  const gap = lastSeen.get(number);
  const timingNudge = gap <= 2 ? -3 : gap <= 12 ? 2 : gap <= 38 ? 0 : -1;
  const score = 100 + (globalRatio - 1) * 22 + (recentRatio - 1) * 8 + timingNudge;

  return Math.round(clamp(score, 88, 112));
}

function bayesianRatio(observed, totalEvents, possibleOutcomes, priorMultiplier) {
  const uniformProbability = 1 / possibleOutcomes;
  const priorEvents = Math.max(totalEvents * priorMultiplier, possibleOutcomes);
  const posterior = (observed + priorEvents * uniformProbability) / (totalEvents + priorEvents);
  return posterior / uniformProbability;
}

function scoreNumberHistory(number, frequencies, recentFrequencies, lastSeen, drawCount, recentCount) {
  const expected = (drawCount * 5) / 49;
  const recentExpected = (recentCount * 5) / 49;
  const frequencyScore = (frequencies.get(number) / expected) * 100;
  const recentScore = (recentFrequencies.get(number) / recentExpected) * 100;
  const gap = lastSeen.get(number);
  const absenceScore = gap <= 1 ? 72 : gap <= 8 ? 100 : gap <= 20 ? 92 : gap <= 45 ? 78 : 62;
  const score = frequencyScore * 0.52 + recentScore * 0.26 + absenceScore * 0.22;

  return Math.round(clamp(score, 60, 150));
}

function chooseNumbers(stats, mode) {
  const choices = buildNumberChoices(stats, mode);
  const selected = mode === "history" ? choices.combinations[0] : pickWeightedCombination(choices.elite, choices.bestScore);
  const rank = choices.combinations.findIndex((item) => item.numbers.join("-") === selected.numbers.join("-")) + 1;
  const selectionIndex = mode === "history" ? { value: 100, label: "historique" } : buildSelectionIndex(selected, choices.elite);

  return {
    numbers: selected.numbers,
    diagnostics: {
      ...explainCombination(selected.numbers, stats),
      rank,
      eliteCount: choices.elite.length,
      selectionIndex,
    },
  };
}

function buildNumberChoices(stats, mode) {
  const candidates = Array.from({ length: 49 }, (_, index) => index + 1)
    .map((number) => ({ number, score: adjustedScore(number, [], stats, mode) }))
    .sort((a, b) => b.score - a.score || a.number - b.number)
    .slice(0, 28)
    .map((item) => item.number);

  const combinations = [];
  for (let a = 0; a < candidates.length - 4; a += 1) {
    for (let b = a + 1; b < candidates.length - 3; b += 1) {
      for (let c = b + 1; c < candidates.length - 2; c += 1) {
        for (let d = c + 1; d < candidates.length - 1; d += 1) {
          for (let e = d + 1; e < candidates.length; e += 1) {
            const numbers = [candidates[a], candidates[b], candidates[c], candidates[d], candidates[e]].sort((x, y) => x - y);
            const score = scoreCombination(numbers, stats, mode);
            combinations.push({ numbers, score });
          }
        }
      }
    }
  }

  combinations.sort((a, b) => b.score - a.score || a.numbers.join("-").localeCompare(b.numbers.join("-")));
  const bestScore = combinations[0].score;
  const elite = combinations
    .filter((item) => item.score >= bestScore * 0.92)
    .slice(0, 80);

  return { combinations, elite, bestScore };
}

function pickWeightedCombination(items, bestScore) {
  return weightedChoice(items, (item) => {
    const edge = Math.max(0, item.score - bestScore * 0.9);
    return Math.max(1, edge * edge);
  });
}

function buildSelectionIndex(selected, elite) {
  const scores = elite.map((item) => item.score);
  const lowest = Math.min(...scores);
  const highest = Math.max(...scores);
  const ratio = highest === lowest ? 0.5 : (selected.score - lowest) / (highest - lowest);
  const value = Math.round(62 + clamp(ratio, 0, 1) * 28);
  const label = value >= 84 ? "fort" : value >= 74 ? "bon" : "correct";

  return { value, label };
}

function adjustedScore(number, chosen, stats, mode) {
  const overdue = stats.lastSeen.get(number);
  const baseDeviation = stats.numberScores.get(number) - 100;
  const pairBoost = chosen.reduce((sum, selected) => {
    return sum + (stats.pairFrequency.get(pairKey(number, selected)) || 0);
  }, 0);

  if (mode === "history") {
    return stats.historyScores.get(number) + pairBoost * 5.5 + balanceBonus([...chosen, number], stats.averageSum) * 1.6;
  }

  let score = 100 + baseDeviation;
  if (mode === "hot") score += baseDeviation * 0.65;
  if (mode === "overdue") score += overdue <= 2 ? -4 : overdue <= 14 ? 2 : overdue <= 36 ? 4 : 1;

  score += pairBoost * 1.35;
  score += balanceBonus([...chosen, number], stats.averageSum) * 0.45;
  return score;
}

function scoreCombination(numbers, stats, mode) {
  const baseScore = numbers.reduce((sum, number) => sum + adjustedScore(number, numbers.filter((n) => n !== number), stats, mode), 0);

  if (mode === "history") {
    return baseScore + pairTotal(numbers, stats) * 4.5 + balanceBonus(numbers, stats.averageSum) * 2.4 + spreadBonus(numbers) * 1.1;
  }

  const pairScore = pairTotal(numbers, stats) * 1.4;
  return baseScore + pairScore + balanceBonus(numbers, stats.averageSum) * 1.1 + spreadBonus(numbers) * 0.45;
}

function pairTotal(numbers, stats) {
  let total = 0;
  for (let i = 0; i < numbers.length; i += 1) {
    for (let j = i + 1; j < numbers.length; j += 1) {
      total += stats.pairFrequency.get(pairKey(numbers[i], numbers[j])) || 0;
    }
  }
  return total;
}

function spreadBonus(numbers) {
  const decades = new Set(numbers.map((number) => Math.floor((number - 1) / 10)));
  const consecutivePairs = numbers.filter((number, index) => index > 0 && number === numbers[index - 1] + 1).length;
  return decades.size * 14 - consecutivePairs * 8;
}

function explainCombination(numbers, stats) {
  const ranked = numbers
    .map((number) => ({
      number,
      score: stats.numberScores.get(number),
      frequency: stats.numberFrequency.get(number),
      gap: stats.lastSeen.get(number),
    }))
    .sort((a, b) => b.score - a.score);

  return {
    strongest: formatNumberList(ranked.slice(0, 2).map((item) => item.number)),
    watched: formatNumberList(ranked.slice(-2).map((item) => item.number)),
    pairTotal: pairTotal(numbers, stats),
  };
}

function formatNumberList(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted.join("");
  return `${sorted.slice(0, -1).join(", ")} et ${sorted.at(-1)}`;
}

function balanceBonus(numbers, averageSum) {
  const odds = numbers.filter((number) => number % 2 === 1).length;
  const highs = numbers.filter((number) => number >= 25).length;
  const sum = numbers.reduce((a, b) => a + b, 0);
  const sumTarget = averageSum * (numbers.length / 5);

  let bonus = 0;
  if (odds >= 2 && odds <= 3) bonus += 18;
  if (highs >= 2 && highs <= 3) bonus += 14;
  bonus -= Math.abs(sum - sumTarget) * 0.22;
  return bonus;
}

function chooseChance(stats, mode) {
  const candidates = Array.from({ length: 10 }, (_, index) => {
    const chance = index + 1;
    const ratio = bayesianRatio(stats.chanceFrequency.get(chance), stats.drawCount, 10, 5);
    const gap = stats.chanceLastSeen.get(chance);

    if (mode === "history") {
      const expected = stats.drawCount / 10;
      const frequencyScore = (stats.chanceFrequency.get(chance) / expected) * 100;
      const absenceScore = gap <= 1 ? 72 : gap <= 8 ? 100 : gap <= 24 ? 88 : 70;
      return { number: chance, score: frequencyScore * 0.72 + absenceScore * 0.28 };
    }

    let score = 100 + (ratio - 1) * 16;
    if (gap <= 1) score -= 3;
    if (gap >= 8 && gap <= 28) score += 2;
    if (mode === "hot") score += (ratio - 1) * 8;
    if (mode === "overdue") score += gap <= 2 ? -2 : gap <= 30 ? 3 : 0;
    return { number: chance, score };
  }).sort((a, b) => b.score - a.score || a.number - b.number);

  if (mode === "history") return { number: candidates[0].number, rank: 1 };

  const selected = weightedChoice(candidates, (item) => {
    const lightSignal = clamp((item.score - 100) / 100, -0.18, 0.18);
    return 1 + lightSignal;
  });
  return { number: selected.number, rank: candidates.findIndex((item) => item.number === selected.number) + 1 };
}

function createPack(count = 3) {
  const sample = activeDraws();
  const mode = elements.modeSelect.value;
  const stats = buildStats(sample);
  const choices = buildNumberChoices(stats, mode);
  const pack = [];
  const mainNumbers = state.current?.numbers || [];
  const diversePool = choices.combinations
    .filter((item) => item.score >= choices.bestScore * 0.84)
    .slice(0, 600);

  for (let attempt = 0; pack.length < count && attempt < 220; attempt += 1) {
    const strictPool = diversePool.filter((item) => isPackCandidate(item.numbers, pack, mainNumbers, 2, 3));
    const relaxedPool = diversePool.filter((item) => isPackCandidate(item.numbers, pack, mainNumbers, 3, 4));
    const pool = strictPool.length ? strictPool : relaxedPool.length ? relaxedPool : diversePool;
    const selected = mode === "history" ? pool[0] : pickWeightedCombination(pool, choices.bestScore);
    const key = selected.numbers.join("-");

    if (pack.some((item) => item.key === key) || key === mainNumbers.join("-")) continue;

    const chanceResult = chooseChance(stats, mode);
    pack.push({
      key,
      numbers: selected.numbers,
      chance: chanceResult.number,
      index: buildSelectionIndex(selected, choices.elite),
    });
  }

  return pack;
}

function isPackCandidate(numbers, pack, mainNumbers, maxSharedPack, maxSharedMain) {
  if (mainNumbers.length && commonNumbers(numbers, mainNumbers) > maxSharedMain) return false;
  return pack.every((item) => commonNumbers(numbers, item.numbers) <= maxSharedPack);
}

function commonNumbers(a, b) {
  const bSet = new Set(b);
  return a.filter((number) => bSet.has(number)).length;
}

function weightedChoice(items, weightFn) {
  const total = items.reduce((sum, item) => sum + weightFn(item), 0);
  let cursor = secureRandom() * total;
  for (const item of items) {
    cursor -= weightFn(item);
    if (cursor <= 0) return item;
  }
  return items[0];
}

function secureRandom() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] / 4294967296;
  }
  return Math.random();
}

function pairKey(a, b) {
  return [a, b].sort((x, y) => x - y).join("-");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function renderPrediction(options = {}) {
  const { numbers, chance, mode, sample, diagnostics } = state.current;
  elements.mainNumbers.classList.remove("is-shuffling");
  elements.chanceNumber.parentElement.classList.remove("is-shuffling");
  elements.chanceNumber.classList.remove("is-placeholder");
  elements.mainNumbers.innerHTML = numbers
    .map((number, index) => {
      const animate = options.animate ? ` is-revealing" style="--delay:${index * 92}ms"` : `"`;
      return `<span class="ball${animate}>${number}</span>`;
    })
    .join("");
  elements.chanceNumber.textContent = chance;
  if (options.animate) {
    elements.chanceNumber.classList.add("is-revealing");
    elements.chanceNumber.style.setProperty("--delay", "520ms");
  } else {
    elements.chanceNumber.classList.remove("is-revealing");
    elements.chanceNumber.style.removeProperty("--delay");
  }
  elements.predictionTitle.textContent = `Pronostic principal du ${formatFrenchDate(nextDrawDateFromLatest(state.draws[0]))}`;
  elements.drawCount.textContent = mode === "history"
    ? `Meilleur score historique · ${sample.length} tirages`
    : `Indice Nono : ${diagnostics.selectionIndex.value}/100 · ${sample.length} tirages`;
  elements.databaseStatus.textContent = `Base FDJ mise à jour le ${state.draws[0].date}`;

  elements.predictionSummary.textContent = mode === "history"
    ? `${modeCopy[mode].label}. Meilleur score calculé sur l'historique FDJ.`
    : `${modeCopy[mode].label}. Hasard contrôlé, historique pondéré avec prudence.`;

  const reasons = mode === "history"
    ? [
        ["Mode historique", "Nono prend la grille la mieux notée par l'historique FDJ, sans tirage pondéré."],
        ["Base analysée", `${sample.length} derniers tirages FDJ sont utilisés pour ce calcul.`],
        ["Pourquoi ces numéros", `Dans cette grille, ${diagnostics.strongest} ressortent fortement, tandis que ${diagnostics.watched} complètent la combinaison.`],
      ]
    : [
        ["Indice Nono", `${diagnostics.selectionIndex.value}/100 : pronostic ${diagnostics.selectionIndex.label}. Cet indice mesure la force du choix, pas une garantie de gain.`],
        ["Méthode", `Le hasard reste majoritaire. Les ${sample.length} derniers tirages FDJ servent seulement à départager les meilleures variantes.`],
        ["Pourquoi ces numéros", `Nono teste des grilles complètes. Dans celle-ci, ${diagnostics.strongest} ressortent le plus, tandis que ${diagnostics.watched} complètent bien la combinaison.`],
      ];

  elements.reasonsList.innerHTML = reasons
    .map(([title, body]) => `<div class="reason"><strong>${title}</strong>${body}</div>`)
    .join("");

  renderHistory(sample);
}

function renderHistory(sample) {
  elements.latestDrawDate.textContent = state.draws[0]?.date || "Indisponible";
  elements.historyList.innerHTML = sample
    .slice(0, 3)
    .map((draw) => {
      const balls = draw.numbers
        .map((number) => `<span class="history-mini-ball">${number}</span>`)
        .join("");
      return `
        <article class="history-item">
          <div class="history-date">${draw.day} ${draw.date}</div>
          <div class="history-numbers">
            ${balls}
            <span class="history-mini-chance">${draw.chance}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderPack() {
  const pack = createPack();
  elements.packList.innerHTML = pack
    .map((grid, index) => {
      const balls = grid.numbers
        .map((number) => `<span class="pack-mini-ball">${number}</span>`)
        .join("");

      return `
        <article class="pack-item">
          <span class="pack-label">Grille ${index + 1}</span>
          <div class="pack-numbers">
            ${balls}
            <span class="pack-mini-chance">${grid.chance}</span>
          </div>
          <span class="pack-index">${grid.index.value}/100</span>
        </article>
      `;
    })
    .join("");
}

function topEntries(map, count) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, count);
}

function updateOptionHelp() {
  elements.windowHelp.textContent = windowCopy[elements.windowSelect.value];
  elements.modeHelp.textContent = modeCopy[elements.modeSelect.value].help;
}

elements.generateButton.addEventListener("click", revealPrediction);
elements.packButton.addEventListener("click", () => {
  const nextState = elements.packPanel.hidden;
  elements.packPanel.hidden = !nextState;
  elements.packButton.setAttribute("aria-expanded", String(nextState));
  elements.packButton.textContent = nextState ? "Masquer" : "Pack";
  if (nextState) renderPack();
});
elements.windowSelect.addEventListener("change", () => {
  updateOptionHelp();
  generate();
});
elements.modeSelect.addEventListener("change", () => {
  updateOptionHelp();
  generate();
});

init().catch((error) => {
  elements.drawCount.textContent = "Erreur";
  elements.predictionSummary.textContent = error.message;
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function triggerVibration() {
  document.body.classList.remove("is-vibrating");
  void document.body.offsetWidth;
  document.body.classList.add("is-vibrating");
  window.setTimeout(() => document.body.classList.remove("is-vibrating"), 560);

  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([35, 25, 45, 25, 55]);
  }
}
