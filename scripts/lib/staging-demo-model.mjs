const AS_OF_DATE = "2026-09-12";

const organisations = [
  {
    key: "eastern",
    name: "Eastern Region Shooting Association",
    shortName: "ERSA",
    slug: "eastern-region-shooting-association",
    type: "regional_association",
    description: "Regional smallbore, air and gallery rifle leagues for clubs across Essex and the eastern counties.",
    address: "County Range, Lower Dunton Road, Basildon, Essex",
    postcode: "SS16 6TH",
    telephone: "01268 555 410",
    email: "secretary@ersa.example.org",
    website: "https://ersa.example.org",
    about: "Eastern Region Shooting Association coordinates postal and shoulder-to-shoulder leagues across the eastern counties. The programme balances established prone disciplines with air rifle, benchrest and multi-position shooting.",
    cards: [
      ["Entry guidance", "Club officials submit complete Individual, Pair and Team entries before the published closing date. Late substitutions must be agreed with the league secretary."],
      ["League programme", "Summer leagues run from May to September. Winter leagues run from October to March, with most competitions using ten fortnightly rounds."],
      ["Competition rules", "Scores must be witnessed at an affiliated range. The current course of fire, deadline and tie-break rules shown on each Competition are authoritative."],
    ],
    clubs: [
      ["basildon", "Basildon Rifle and Pistol Club", "basildon-rifle-and-pistol-club", "Basildon", "Essex", "SS14 3AP"],
      ["chelmsford", "Chelmsford Rifle Club", "chelmsford-rifle-club", "Chelmsford", "Essex", "CM2 8RL"],
      ["colchester", "Colchester Target Shooting Club", "colchester-target-shooting-club", "Colchester", "Essex", "CO3 9AB"],
      ["southend", "Southend-on-Sea Rifle Club", "southend-on-sea-rifle-club", "Southend-on-Sea", "Essex", "SS2 6ER"],
      ["braintree", "Braintree and District Rifle Club", "braintree-and-district-rifle-club", "Braintree", "Essex", "CM7 4AZ"],
    ],
  },
  {
    key: "thames",
    name: "Thames Valley Target Sports Association",
    shortName: "TVTSA",
    slug: "thames-valley-target-sports-association",
    type: "regional_association",
    description: "Inter-club rifle leagues serving Berkshire, Oxfordshire and Buckinghamshire.",
    address: "The Range Office, Sonning Lane, Reading, Berkshire",
    postcode: "RG4 6ST",
    telephone: "0118 555 0284",
    email: "competitions@tvtsa.example.org",
    website: "https://tvtsa.example.org",
    about: "The association provides a consistent inter-club programme for developing and experienced target shooters throughout the Thames Valley.",
    cards: [
      ["Season calendar", "Club secretaries should confirm entries and nominated teams before each seasonal closing date."],
      ["Results queries", "Questions about published results should include the Competition, Round and Club name."],
    ],
    clubs: [
      ["reading", "Reading Rifle and Pistol Club", "reading-rifle-and-pistol-club", "Reading", "Berkshire", "RG1 8DF"],
      ["maidenhead", "Maidenhead Target Shooting Club", "maidenhead-target-shooting-club", "Maidenhead", "Berkshire", "SL6 4JT"],
      ["oxford", "Oxford City Rifle Club", "oxford-city-rifle-club", "Oxford", "Oxfordshire", "OX4 2RD"],
      ["aylesbury", "Aylesbury Marksmen Club", "aylesbury-marksmen-club", "Aylesbury", "Buckinghamshire", "HP20 1RU"],
      ["windsor", "Windsor Smallbore Rifle Club", "windsor-smallbore-rifle-club", "Windsor", "Berkshire", "SL4 5UJ"],
    ],
  },
  {
    key: "northern",
    name: "Northern Counties Rifle League",
    shortName: "NCRL",
    slug: "northern-counties-rifle-league",
    type: "regional_association",
    description: "A long-running club league programme across Yorkshire and neighbouring counties.",
    address: "League Office, Moor Lane, York, North Yorkshire",
    postcode: "YO24 1AB",
    telephone: "01904 555 672",
    email: "league@ncrl.example.org",
    website: "https://ncrl.example.org",
    about: "Northern Counties Rifle League supports regular competitive shooting through accessible divisions and a dependable seasonal calendar.",
    cards: [
      ["Competition administration", "Entries, team declarations and score queries are handled by each Club's appointed official."],
      ["Range standards", "All participating ranges must follow the published safety and witnessing requirements."],
    ],
    clubs: [
      ["york", "York Rifle and Pistol Club", "york-rifle-and-pistol-club", "York", "North Yorkshire", "YO10 4DU"],
      ["harrogate", "Harrogate Target Sports Club", "harrogate-target-sports-club", "Harrogate", "North Yorkshire", "HG2 7SG"],
      ["leeds", "Leeds Smallbore Rifle Club", "leeds-smallbore-rifle-club", "Leeds", "West Yorkshire", "LS10 1LT"],
      ["wakefield", "Wakefield Rifle Club", "wakefield-rifle-club", "Wakefield", "West Yorkshire", "WF1 3AB"],
      ["huddersfield", "Huddersfield Marksmen Club", "huddersfield-marksmen-club", "Huddersfield", "West Yorkshire", "HD1 6QR"],
    ],
  },
];

const seasonDefinitions = [
  ["summer-2024", "Summer League 2024", "completed", "2024-02-01", "2024-03-16", "2024-04-06", "2024-09-30", "2024-04-20"],
  ["winter-2024", "Winter League 2024", "completed", "2024-08-01", "2024-09-14", "2024-10-05", "2025-03-31", "2024-10-19"],
  ["summer-2025", "Summer League 2025", "completed", "2025-02-01", "2025-03-15", "2025-04-05", "2025-09-30", "2025-04-19"],
  ["winter-2025", "Winter League 2025", "completed", "2025-08-01", "2025-09-13", "2025-10-04", "2026-03-31", "2025-10-18"],
  ["summer-2026", "Summer League 2026", "active", "2026-02-02", "2026-03-14", "2026-05-02", "2026-10-03", "2026-05-16"],
  ["winter-2026", "Winter League 2026", "open", "2026-08-03", "2026-09-26", "2026-10-17", "2027-03-27", "2026-10-31"],
];

const seriesTemplates = [
  {
    key: "prone-individual", name: "County Prone Individual League", seasons: "both",
    entryFormat: "individual", teamSize: 1, ranking: "aggregate", equipment: "smallbore_rifle",
    usesX: true, fee: 8, components: [["Ex100", 100, "points_scored", "prone", 25, "yards", 10]],
  },
  {
    key: "prone-pairs", name: "Prone Pairs Championship", seasons: "both",
    entryFormat: "pairs", teamSize: 2, ranking: "round_robin", equipment: "smallbore_rifle",
    usesX: true, fee: 14, components: [["Ex100", 100, "points_scored", "prone", 25, "yards", 10]],
  },
  {
    key: "club-team", name: "County Club Team League", seasons: "both",
    entryFormat: "team", teamSize: 3, ranking: "gun_score", equipment: "smallbore_rifle",
    usesX: false, fee: 24, components: [["Ex100", 100, "points_scored", "prone", 50, "metres", 10]],
  },
  {
    key: "benchrest", name: "Benchrest League", seasons: "summer",
    entryFormat: "individual", teamSize: 1, ranking: "best_n_average", bestRounds: 8,
    equipment: "smallbore_rifle", usesX: false, fee: 9,
    components: [["Ex100", 100, "points_scored", "benchrest", 25, "yards", 10]],
  },
  {
    key: "air-rifle", name: "Indoor Air Rifle League", seasons: "winter",
    entryFormat: "individual", teamSize: 1, ranking: "aggregate", equipment: "air_rifle",
    usesX: true, fee: 8, components: [["Ex100", 100, "points_scored", "standing", 10, "metres", 10]],
  },
  {
    key: "three-position", name: "Three-Position League", seasons: "summer",
    entryFormat: "individual", teamSize: 1, ranking: "aggregate", equipment: "smallbore_rifle",
    usesX: false, fee: 11,
    components: [
      ["Prone", 40, "points_scored", "prone", 50, "metres", 4],
      ["Standing", 30, "points_scored", "standing", 50, "metres", 3],
      ["Kneeling", 30, "points_scored", "kneeling", 50, "metres", 3],
    ],
  },
  {
    key: "gallery-rifle", name: "Gallery Rifle League", seasons: "winter",
    entryFormat: "individual", teamSize: 1, ranking: "gun_score", equipment: "gallery_rifle",
    usesX: false, fee: 10, customEastern: true,
    components: [["Ex100", 100, "points_scored", "standing", 20, "yards", 10]],
  },
];

const averagePrograms = [
  {
    organisationKey: "eastern",
    policyName: "Current then preceding league history",
    contexts: [
      {
        key: "smallbore-prone-25yd",
        name: "Smallbore Prone 25 yd Ex100",
        seriesKeys: ["prone-individual", "prone-pairs"],
      },
      {
        key: "smallbore-prone-50m",
        name: "Smallbore Prone 50 m Ex100",
        seriesKeys: ["club-team"],
      },
      {
        key: "smallbore-benchrest-25yd",
        name: "Smallbore Benchrest 25 yd Ex100",
        seriesKeys: ["benchrest"],
      },
      {
        key: "air-rifle-standing-10m",
        name: "Air Rifle Standing 10 m Ex100",
        seriesKeys: ["air-rifle"],
      },
      {
        key: "smallbore-three-position-50m",
        name: "Smallbore Three-Position 50 m Ex100",
        seriesKeys: ["three-position"],
      },
      {
        key: "service-rifle-supported-20yd",
        name: "Historic Service Rifle Supported 20 yd Ex100",
        seriesKeys: ["gallery-rifle"],
      },
    ],
  },
  ...["thames", "northern"].map((organisationKey) => ({
    organisationKey,
    policyName: "Current then preceding league history",
    contexts: [
      {
        key: "smallbore-prone-25yd",
        name: "Smallbore Prone 25 yd Ex100",
        seriesKeys: ["prone-individual", "prone-pairs"],
      },
      {
        key: "smallbore-prone-50m",
        name: "Smallbore Prone 50 m Ex100",
        seriesKeys: ["club-team"],
      },
      {
        key: "smallbore-benchrest-25yd",
        name: "Smallbore Benchrest 25 yd Ex100",
        seriesKeys: ["benchrest"],
      },
      {
        key: "air-rifle-standing-10m",
        name: "Air Rifle Standing 10 m Ex100",
        seriesKeys: ["air-rifle"],
      },
    ],
  })),
].map((program) => ({
  ...program,
  strategy: "current_then_preceding",
  configuration: {
    minimum_current_scores: 4,
    minimum_preceding_scores: 4,
    fallback: "manual",
  },
  contexts: program.contexts.map((context) => ({ ...context, basisMaximum: 100 })),
}));

const firstNames = [
  "Oliver", "Amelia", "George", "Isla", "Harry", "Ava", "Jack", "Mia",
  "Charlie", "Grace", "Thomas", "Freya", "James", "Sophie", "William", "Emily",
  "Daniel", "Lucy", "Samuel", "Alice", "Henry", "Ella", "Arthur", "Charlotte",
];
const lastNames = [
  "Carter", "Bennett", "Hughes", "Foster", "Walsh", "Turner", "Clarke", "Murray",
  "Spencer", "Webb", "Fletcher", "Reed", "Marshall", "Pearson", "Chapman", "Atkinson",
  "Holland", "Barrett", "Lawson", "Jennings", "Thornton", "Mason", "Palmer", "Sutton",
];

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function sourceTimestamp(deadline, sourceIndex) {
  const value = new Date(`${deadline}T18:00:00Z`);
  value.setUTCSeconds(value.getUTCSeconds() + sourceIndex);
  return value.toISOString();
}

function seriesKeysFor(index) {
  return [
    ["prone-individual", "prone-pairs", "club-team", "benchrest", "three-position"],
    ["prone-individual", "prone-pairs", "air-rifle", "gallery-rifle"],
    ["prone-pairs", "club-team", "benchrest"],
    ["prone-individual", "club-team", "air-rifle", "three-position"],
    ["prone-individual", "prone-pairs", "benchrest", "gallery-rifle"],
    ["prone-pairs", "club-team", "air-rifle"],
    ["prone-individual", "three-position"],
  ][Math.floor(index / 5) % 7];
}

function scorePercentage(shooter, seasonIndex, roundNumber, sourceIndex) {
  if (shooter.showcase) {
    const variation = [-0.018, 0.006, -0.004, 0.017, -0.011, 0.009, 0.001, 0.004, -0.007, 0.013];
    return Math.min(0.96, 0.842 + sourceIndex * 0.00075 + variation[sourceIndex % variation.length]);
  }
  const bases = { strong: 0.925, midfield: 0.855, developing: 0.775 };
  const trend = shooter.progression === "improving" ? seasonIndex * 0.012
    : shooter.progression === "fluctuating" ? ((seasonIndex % 3) - 1) * 0.009 : 0;
  const variation = (((shooter.index * 13 + roundNumber * 7 + seasonIndex * 5) % 11) - 5) * 0.004;
  return Math.max(0.62, Math.min(0.985, bases[shooter.skill] + trend + variation));
}

export function buildStagingDemoModel(showcase = {}) {
  const shooters = [];
  let syntheticIndex = 0;
  for (const organisation of organisations) {
    for (let index = 0; index < 32; index += 1) {
      const isShowcase = organisation.key === "eastern" && index === 0;
      if (isShowcase) {
        shooters.push({
          key: "showcase", organisationKey: organisation.key, clubKey: "basildon",
          firstName: showcase.firstName ?? "Showcase", lastName: showcase.lastName ?? "Shooter",
          email: showcase.email ?? null, showcase: true, index,
          skill: "strong", progression: "improving",
          seriesKeys: ["prone-individual", "prone-pairs", "air-rifle", "three-position"],
        });
        continue;
      }
      const nameIndex = syntheticIndex;
      shooters.push({
        key: `${organisation.key}-${String(index).padStart(2, "0")}`,
        organisationKey: organisation.key,
        clubKey: organisation.clubs[index % organisation.clubs.length][0],
        firstName: firstNames[nameIndex % firstNames.length],
        lastName: lastNames[(nameIndex * 7 + Math.floor(nameIndex / firstNames.length) * 3) % lastNames.length],
        email: `rifle-leagues-${organisation.key}-${String(index).padStart(2, "0")}@shooters.invalid`,
        showcase: false,
        index,
        skill: index % 5 === 0 ? "strong" : index % 3 === 0 ? "developing" : "midfield",
        progression: index % 4 === 0 ? "improving" : index % 4 === 1 ? "fluctuating" : "stable",
        seriesKeys: seriesKeysFor(index),
      });
      syntheticIndex += 1;
    }
  }

  const seasons = organisations.flatMap((organisation) => seasonDefinitions.map((definition, index) => ({
    key: `${organisation.key}:${definition[0]}`,
    organisationKey: organisation.key,
    slug: definition[0], name: definition[1], status: definition[2],
    entryOpensAt: definition[3], entryClosesAt: definition[4], startsAt: definition[5],
    endsAt: definition[6], firstDeadline: definition[7], index,
    kind: definition[0].startsWith("summer") ? "summer" : "winter",
  })));

  const series = organisations.flatMap((organisation) => seriesTemplates.map((template) => ({
    ...template,
    key: `${organisation.key}:${template.key}`,
    organisationKey: organisation.key,
    slug: template.key,
    equipment: template.customEastern && organisation.key === "eastern" ? null : template.equipment,
    customEquipment: template.customEastern && organisation.key === "eastern" ? "Historic Service Rifle" : null,
    components: template.components.map((component) => ({
      label: component[0], maximum: component[1], scoreMethod: component[2],
      position: component[3], customPosition: template.customEastern && organisation.key === "eastern"
        ? "Supported Standing" : null,
      distance: component[4], distanceUnit: component[5], shots: component[6],
    })),
  })));

  const competitions = [];
  for (const season of seasons) {
    const applicable = series.filter((item) => item.organisationKey === season.organisationKey
      && (item.seasons === "both" || item.seasons === season.kind));
    for (const item of applicable) {
      competitions.push({
        key: `${season.key}:${item.slug}`, organisationKey: season.organisationKey,
        seasonKey: season.key, seasonIndex: season.index, seriesKey: item.key,
        templateKey: item.slug, name: item.name, slug: item.slug, status: "published",
        entryFormat: item.entryFormat, teamSize: item.teamSize, ranking: item.ranking,
        bestRounds: item.bestRounds ?? null, equipment: item.equipment,
        customEquipment: item.customEquipment, usesX: item.usesX, fee: item.fee,
        setsPerRound: 1, components: item.components, oneOff: false,
        rounds: Array.from({ length: 10 }, (_, index) => ({
          number: index + 1,
          deadline: addDays(season.firstDeadline, index * 14),
          shootByDate: addDays(season.firstDeadline, index * 14 - 3),
        })),
      });
    }
    if (season.organisationKey === "eastern" && season.slug === "summer-2026") {
      competitions.push({
        key: `${season.key}:eastern-dewar-open`, organisationKey: "eastern",
        seasonKey: season.key, seasonIndex: season.index, seriesKey: null,
        templateKey: "eastern-dewar-open", name: "Eastern Dewar Open", slug: "eastern-dewar-open",
        status: "published", entryFormat: "individual", teamSize: 1, ranking: "aggregate",
        bestRounds: null, equipment: "smallbore_rifle", customEquipment: null,
        usesX: true, fee: 12, setsPerRound: 1, oneOff: true,
        components: [
          { label: "50 m", maximum: 50, scoreMethod: "points_scored", position: "prone", distance: 50, distanceUnit: "metres", shots: 5 },
          { label: "100 yd", maximum: 50, scoreMethod: "points_scored", position: "prone", distance: 100, distanceUnit: "yards", shots: 5 },
        ],
        rounds: Array.from({ length: 10 }, (_, index) => ({
          number: index + 1, deadline: addDays(season.firstDeadline, index * 14),
          shootByDate: addDays(season.firstDeadline, index * 14 - 3),
        })),
      });
    }
  }

  const participations = [];
  const dropoutCases = [];
  for (const competition of competitions) {
    const season = seasons.find((item) => item.key === competition.seasonKey);
    let candidates = shooters.filter((shooter) => shooter.organisationKey === competition.organisationKey);
    if (competition.oneOff) {
      candidates = candidates.filter((shooter) => !shooter.showcase && shooter.index % 3 === 0);
    } else {
      candidates = candidates.filter((shooter) => {
        if (shooter.showcase) {
          return shooter.seriesKeys.includes(competition.templateKey);
        }
        if (!shooter.seriesKeys.includes(competition.templateKey)) return false;
        // A deliberate first-time Three-Position entrant demonstrates that
        // history in the shooter's Prone Context is not compatible here.
        if (shooter.key === "eastern-31" && competition.templateKey === "three-position"
          && season.index < 4) return false;
        if (competition.entryFormat !== "individual") return true;
        const joinAt = shooter.index % 13 === 0 ? 1 : 0;
        const stopAfter = shooter.index % 17 === 0 ? 4 : 5;
        if (season.index < joinAt || season.index > stopAfter) return false;
        return (shooter.index + season.index + seriesTemplates.findIndex((x) => x.key === competition.templateKey)) % 17 !== 0;
      });
    }
    for (const organisation of organisations.filter((item) => item.key === competition.organisationKey)) {
      for (const club of organisation.clubs) {
        const clubShooters = candidates.filter((shooter) => shooter.clubKey === club[0])
          .sort((left, right) => left.index - right.index);
        const usableCount = Math.floor(clubShooters.length / competition.teamSize) * competition.teamSize;
        const participantGroups = [];
        for (let offset = 0; offset < usableCount; offset += competition.teamSize) {
          participantGroups.push(clubShooters.slice(offset, offset + competition.teamSize));
        }
        if (participantGroups.length === 0) continue;
        participations.push({
          key: `${competition.key}:${club[0]}`, competitionKey: competition.key,
          clubKey: `${competition.organisationKey}:${club[0]}`,
          entrants: participantGroups.map((members, index) => ({
            key: `${competition.key}:${club[0]}:${index + 1}`, position: index + 1,
            members: members.map((shooter, slot) => ({ shooterKey: shooter.key, slot: slot + 1 })),
          })),
        });
      }
    }
    if (competition.organisationKey === "eastern" && season.status !== "open") {
      const dropoutCompetition = season.kind === "summer" ? "benchrest" : "air-rifle";
      if (competition.templateKey === dropoutCompetition) {
        const member = participations
          .filter((item) => item.competitionKey === competition.key)
          .flatMap((item) => item.entrants)
          .flatMap((item) => item.members)
          .find((item) => item.shooterKey !== "showcase");
        if (member) dropoutCases.push({ seasonKey: season.key, competitionKey: competition.key, shooterKey: member.shooterKey, scoredThroughRound: 4 });
      }
    }
  }

  const scores = [];
  const concurrentCompetitionKeys = new Set([
    "eastern:summer-2026:prone-individual",
    "eastern:summer-2026:prone-pairs",
  ]);
  const sourceByConcurrentKey = new Map();
  let showcaseSourceIndex = 0;
  for (const participation of participations) {
    const competition = competitions.find((item) => item.key === participation.competitionKey);
    const season = seasons.find((item) => item.key === competition.seasonKey);
    for (const entrant of participation.entrants) {
      for (const member of entrant.members) {
        const shooter = shooters.find((item) => item.key === member.shooterKey);
        const dropout = dropoutCases.find((item) => item.competitionKey === competition.key && item.shooterKey === shooter.key);
        for (const round of competition.rounds) {
          if (round.deadline >= AS_OF_DATE) continue;
          if (dropout && round.number > dropout.scoredThroughRound) continue;
          const concurrent = concurrentCompetitionKeys.has(competition.key);
          const physicalKey = concurrent ? `eastern:summer-2026:physical:${shooter.key}:${round.number}`
            : `${competition.key}:${shooter.key}:${round.number}`;
          let source = sourceByConcurrentKey.get(physicalKey);
          if (!source) {
            const percentage = scorePercentage(shooter, season.index, round.number, shooter.showcase ? showcaseSourceIndex : scores.length);
            if (shooter.showcase) showcaseSourceIndex += 1;
            source = {
              key: physicalKey, shooterKey: shooter.key, concurrent, roundNumber: round.number,
              occurredAt: sourceTimestamp(round.deadline, scores.length),
              percentage, values: competition.components.map((component, index) => ({
                setNumber: 1, componentPosition: index + 1,
                achieved: Math.round(component.maximum * percentage * 100) / 100,
                xCount: competition.usesX ? Math.max(0, Math.min(component.shots, Math.round(component.shots * percentage * 0.65))) : null,
              })),
              usages: [],
            };
            scores.push(source);
            sourceByConcurrentKey.set(physicalKey, source);
          }
          source.usages.push({ competitionKey: competition.key, roundNumber: round.number, entrantKey: entrant.key, shooterKey: shooter.key });
        }
      }
    }
  }

  return {
    asOfDate: AS_OF_DATE,
    organisations: organisations.map((organisation) => ({
      ...organisation,
      clubs: organisation.clubs.map((club) => ({
        key: `${organisation.key}:${club[0]}`, localKey: club[0], name: club[1], slug: club[2],
        town: club[3], county: club[4], postcode: club[5],
        website: `https://${club[2]}.example.org`,
        about: `${club[1]} welcomes league shooters across prone, standing and supported disciplines, with regular coached practice and inter-club competition.`,
      })),
    })),
    shooters, seasons, series, competitions, participations, dropoutCases, scores,
    averagePrograms,
    customEquipment: { organisationKey: "eastern", name: "Historic Service Rifle", normalizedName: "historic service rifle" },
    customPosition: { organisationKey: "eastern", name: "Supported Standing", normalizedName: "supported standing" },
  };
}

export { AS_OF_DATE };
