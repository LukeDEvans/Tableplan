// Provider responses for the scores tests, cut down from real ones fetched on
// 2026-10-07/08 (field names and nesting are the providers'; odds, tickets,
// leaders and most links are removed). Entries marked SYNTHETIC were written by
// hand to cover a state the captured day didn't have.

const espnTeam = (id, abbr, displayName, shortDisplayName, color, logo) => ({
  id, uid: `s:x~t:${id}`, abbreviation: abbr, displayName, shortDisplayName, name: shortDisplayName, location: shortDisplayName, color, alternateColor: "ffffff", isActive: true, logo
});

// site.api.espn.com/apis/site/v2/sports/soccer/uefa.nations/scoreboard
export const ESPN_SOCCER_SCOREBOARD = {
  leagues: [{ id: "2395", name: "UEFA Nations League", slug: "uefa.nations" }],
  day: { date: "2026-10-05" },
  events: [
    {
      id: "401861127", uid: "s:600~l:2395~e:401861127", date: "2026-10-05T16:00Z", name: "Latvia at Cyprus", shortName: "LVA @ CYP",
      competitions: [{
        id: "401861127", date: "2026-10-05T16:00Z", timeValid: true,
        status: { clock: 2340.0, displayClock: "39'", period: 1, type: { id: "25", name: "STATUS_FIRST_HALF", state: "in", completed: false, description: "First Half", detail: "39'", shortDetail: "39'" } },
        venue: { id: "1606", fullName: "GSP Stadium", address: { city: "Nicosia", country: "Cyprus" } },
        altGameNote: "UEFA Nations League, Group C2", group: { groupId: "10", name: "Group C2", abbreviation: "Group C2" }, notes: [],
        geoBroadcasts: [{ type: { id: "1", shortName: "TV" }, market: { id: "1", type: "National" }, media: { shortName: "FS2" }, lang: "en", region: "us" }],
        broadcasts: [{ market: "national", names: ["FS2"] }], broadcast: "",
        competitors: [
          { id: "445", uid: "s:600~t:445", type: "team", order: 0, homeAway: "home", winner: false, form: "WDLWD", score: "0",
            records: [{ name: "All Splits", type: "total", summary: "1-1-1", abbreviation: "Total" }],
            team: espnTeam("445", "CYP", "Cyprus", "Cyprus", "195ccd", "https://a.espncdn.com/i/teamlogos/countries/500/cyp.png") },
          { id: "456", uid: "s:600~t:456", type: "team", order: 1, homeAway: "away", winner: false, form: "LDLWW", score: "0",
            records: [{ name: "All Splits", type: "total", summary: "0-1-2", abbreviation: "Total" }],
            team: espnTeam("456", "LVA", "Latvia", "Latvia", "992242", "https://a.espncdn.com/i/teamlogos/countries/500/lva.png") }
        ]
      }],
      status: { clock: 2340.0, displayClock: "39'", period: 1, type: { id: "25", name: "STATUS_FIRST_HALF", state: "in", completed: false, description: "First Half", detail: "39'", shortDetail: "39'" } },
      links: [
        { language: "en-US", rel: ["live", "desktop", "event"], href: "https://www.espn.com/soccer/match/_/gameId/401861127", text: "Gamecast" },
        { language: "en-US", rel: ["team-stats", "desktop", "event"], href: "https://www.espn.com/soccer/team-stats/_/gameId/401861127/league/uefa.nations", text: "Team Stats" }
      ]
    },
    {
      id: "401861129", uid: "s:600~l:2395~e:401861129", date: "2026-10-05T18:45Z", name: "Belgium at France", shortName: "BEL @ FRA",
      competitions: [{
        id: "401861129", date: "2026-10-05T18:45Z", timeValid: true,
        status: { clock: 0.0, displayClock: "0'", type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false, description: "Scheduled", detail: "Mon, October 5th at 2:45 PM EDT", shortDetail: "Scheduled" } },
        venue: { id: "1547", fullName: "Stade de France" },
        altGameNote: "UEFA Nations League, Group A1", group: { groupId: "1", name: "Group A1" }, notes: [], geoBroadcasts: [], broadcasts: [], broadcast: "",
        competitors: [
          { id: "478", type: "team", homeAway: "home", winner: false, score: "0", records: [{ name: "All Splits", type: "total", summary: "2-1-0" }],
            team: espnTeam("478", "FRA", "France", "France", "000080", "https://a.espncdn.com/i/teamlogos/countries/500/fra.png") },
          { id: "459", type: "team", homeAway: "away", winner: false, score: "0", records: [{ name: "All Splits", type: "total", summary: "2-0-1" }],
            team: espnTeam("459", "BEL", "Belgium", "Belgium", "E30613", "https://a.espncdn.com/i/teamlogos/countries/500/bel.png") }
        ]
      }],
      links: [{ language: "en-US", rel: ["summary", "desktop", "event"], href: "https://www.espn.com/soccer/match/_/gameId/401861129/belgium-france", text: "Summary" }]
    },
    // SYNTHETIC: a match decided on penalties, and one called off.
    {
      id: "900000001", date: "2026-10-05T12:00Z", name: "Sweden at Romania",
      competitions: [{
        status: { type: { name: "STATUS_FINAL_PEN", state: "post", completed: true, shortDetail: "FT-Pens" } },
        competitors: [
          { id: "473", homeAway: "home", winner: false, score: "1", shootoutScore: 3, team: espnTeam("473", "ROU", "Romania", "Romania", "fcd116", "https://a.espncdn.com/i/teamlogos/countries/500/rom.png") },
          { id: "466", homeAway: "away", winner: true, score: "1", shootoutScore: 4, team: espnTeam("466", "SWE", "Sweden", "Sweden", "fecb00", "https://a.espncdn.com/i/teamlogos/countries/500/swe.png") }
        ]
      }]
    },
    {
      id: "900000002", date: "2026-10-05T18:45Z", name: "Hungary at Ukraine",
      competitions: [{
        status: { type: { name: "STATUS_POSTPONED", state: "post", completed: false, shortDetail: "Postponed" } },
        competitors: [
          { id: "457", homeAway: "home", score: "0", team: espnTeam("457", "UKR", "Ukraine", "Ukraine", "fede00", "https://a.espncdn.com/i/teamlogos/countries/500/ukr.png") },
          { id: "480", homeAway: "away", score: "0", team: espnTeam("480", "HUN", "Hungary", "Hungary", "ce2029", "https://a.espncdn.com/i/teamlogos/countries/500/hun.png") }
        ]
      }]
    }
  ]
};

// …/sports/hockey/nhl/scoreboard?dates=20261007
export const ESPN_NHL_SCOREBOARD = {
  events: [
    {
      id: "401891830", date: "2026-10-07T23:30Z",
      status: { clock: 0.0, displayClock: "0:00", period: 0, type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false, description: "Scheduled", detail: "Wed, October 7th at 7:30 PM EDT", shortDetail: "10/7 - 7:30 PM EDT" } },
      competitions: [{
        status: { clock: 0.0, displayClock: "0:00", period: 0, type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false, shortDetail: "10/7 - 7:30 PM EDT" } },
        broadcasts: [{ market: "national", names: ["TNT"] }], notes: [],
        competitors: [
          { id: "23", uid: "s:70~l:90~t:23", type: "team", order: 0, homeAway: "home", score: "0",
            records: [{ name: "overall", abbreviation: "TOTAL", type: "total", summary: "1-1-0" }, { name: "Home", type: "home", summary: "0-0-0" }],
            team: { ...espnTeam("23", "WSH", "Washington Capitals", "Capitals", "d71830", "https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/wsh.png"), logoDark: "https://a.espncdn.com/i/teamlogos/nhl/500-dark/scoreboard/wsh.png" } },
          { id: "16", uid: "s:70~l:90~t:16", type: "team", order: 1, homeAway: "away", score: "0",
            records: [{ name: "overall", abbreviation: "TOTAL", type: "total", summary: "2-1-0" }],
            team: espnTeam("16", "PIT", "Pittsburgh Penguins", "Penguins", "000000", "https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/pit.png") }
        ]
      }]
    },
    // SYNTHETIC: a game in progress and an overtime final.
    {
      id: "900000010", date: "2026-10-07T23:00Z",
      competitions: [{
        status: { clock: 332.0, displayClock: "5:32", period: 3, type: { id: "2", name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: "5:32 - 3rd" } },
        broadcasts: [{ market: "national", names: ["ESPN+"] }, { market: "away", names: ["Altitude Sports"] }],
        competitors: [
          { id: "28", homeAway: "home", score: "2", team: espnTeam("28", "WPG", "Winnipeg Jets", "Jets", "002d62", "https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/wpg.png") },
          { id: "17", homeAway: "away", score: "3", team: espnTeam("17", "COL", "Colorado Avalanche", "Avalanche", "860038", "https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/col.png") }
        ]
      }]
    },
    {
      id: "900000011", date: "2026-10-07T22:00Z",
      competitions: [{
        status: { period: 4, type: { id: "3", name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final/OT" } },
        competitors: [
          { id: "30", homeAway: "home", winner: true, score: "4", team: espnTeam("30", "MIN", "Minnesota Wild", "Wild", "124734", "https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/min.png") },
          { id: "19", homeAway: "away", winner: false, score: "3", team: espnTeam("19", "STL", "St. Louis Blues", "Blues", "0070b9", "https://a.espncdn.com/i/teamlogos/nhl/500/scoreboard/stl.png") }
        ]
      }]
    }
  ]
};

// …/sports/football/college-football/scoreboard?dates=20261003&groups=80
export const ESPN_NCAAF_SCOREBOARD = {
  events: [
    {
      id: "401856705", date: "2026-10-03T16:45Z",
      status: { type: { id: "3", name: "STATUS_FINAL", state: "post", completed: true, description: "Final", detail: "Final", shortDetail: "Final" } },
      competitions: [{
        conferenceCompetition: true, neutralSite: false, notes: [], broadcasts: [{ market: "national", names: ["SEC Network"] }],
        competitors: [
          { id: "61", homeAway: "home", score: "38", winner: true, curatedRank: { current: 2 },
            records: [{ name: "overall", abbreviation: "Game", type: "total", summary: "5-0" }, { name: "vs. Conf.", type: "vsconf", summary: "3-0" }],
            linescores: [{ value: 7.0, displayValue: "7", period: 1 }],
            team: espnTeam("61", "UGA", "Georgia Bulldogs", "Georgia", "ba0c2f", "https://a.espncdn.com/i/teamlogos/ncaa/500/61.png") },
          { id: "238", homeAway: "away", score: "14", winner: false, curatedRank: { current: 99 },
            records: [{ name: "overall", abbreviation: "Game", type: "total", summary: "3-2" }],
            team: espnTeam("238", "VAN", "Vanderbilt Commodores", "Vanderbilt", "000000", "https://a.espncdn.com/i/teamlogos/ncaa/500/238.png") }
        ]
      }]
    },
    // SYNTHETIC: two unranked teams, and a live game with a down-and-distance.
    {
      id: "900000020", date: "2026-10-03T19:30Z",
      competitions: [{
        status: { type: { name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" } },
        competitors: [
          { id: "135", homeAway: "home", score: "27", winner: true, curatedRank: { current: 99 }, team: espnTeam("135", "MINN", "Minnesota Golden Gophers", "Minnesota", "5e0a2f", "https://a.espncdn.com/i/teamlogos/ncaa/500/135.png") },
          { id: "164", homeAway: "away", score: "20", winner: false, curatedRank: { current: 99 }, team: espnTeam("164", "RUTG", "Rutgers Scarlet Knights", "Rutgers", "d21034", "https://a.espncdn.com/i/teamlogos/ncaa/500/164.png") }
        ]
      }]
    },
    {
      id: "900000021", date: "2026-10-03T23:30Z",
      competitions: [{
        status: { clock: 421, displayClock: "7:01", period: 2, type: { name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: "7:01 - 2nd" } },
        situation: { downDistanceText: "2nd & 7 at ORE 34", shortDownDistanceText: "2nd & 7", possession: "2483", isRedZone: false },
        competitors: [
          { id: "2483", homeAway: "home", score: "10", curatedRank: { current: 6 }, team: espnTeam("2483", "ORE", "Oregon Ducks", "Oregon", "007030", "https://a.espncdn.com/i/teamlogos/ncaa/500/2483.png") },
          { id: "264", homeAway: "away", score: "7", curatedRank: { current: 99 }, team: espnTeam("264", "WASH", "Washington Huskies", "Washington", "33006f", "https://a.espncdn.com/i/teamlogos/ncaa/500/264.png") }
        ]
      }]
    }
  ]
};

// …/sports/football/nfl/teams/16/schedule — scores are objects here, and a team
// carries `logos`, not `logo`.
const schedTeam = (id, abbr, displayName, slug) => ({ id, abbreviation: abbr, displayName, shortDisplayName: displayName.split(" ").pop(), logos: [{ href: `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png`, width: 500, height: 500, rel: ["full", "default"] }, { href: `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${slug}.png`, rel: ["full", "dark"] }] });
export const ESPN_NFL_SCHEDULE = {
  timestamp: "2026-10-08T03:00:00Z", status: "success", season: { year: 2026 }, team: { id: "16", displayName: "Minnesota Vikings", logo: "https://a.espncdn.com/i/teamlogos/nfl/500/min.png" },
  events: [
    {
      id: "401872927", date: "2026-09-13T20:25Z", name: "Green Bay Packers at Minnesota Vikings", shortName: "GB @ MIN", week: { number: 1, text: "Week 1" },
      competitions: [{
        status: { clock: 0.0, displayClock: "0:00", period: 4, type: { id: "3", name: "STATUS_FINAL", state: "post", completed: true, description: "Final", detail: "Final", shortDetail: "Final" }, isTBDFlex: false },
        broadcasts: [{ type: { id: "1", shortName: "TV" }, market: { id: "1", type: "National" }, media: { shortName: "CBS" }, lang: "en", region: "us" }],
        competitors: [
          { id: "16", homeAway: "home", winner: true, score: { value: 39.0, displayValue: "39" }, team: schedTeam("16", "MIN", "Minnesota Vikings", "min") },
          { id: "9", homeAway: "away", winner: false, score: { value: 22.0, displayValue: "22" }, team: schedTeam("9", "GB", "Green Bay Packers", "gb") }
        ]
      }]
    },
    {
      id: "401873014", date: "2026-10-11T17:00Z", name: "Indianapolis Colts at Minnesota Vikings", shortName: "IND @ MIN", week: { number: 5, text: "Week 5" },
      competitions: [{
        status: { clock: 0.0, displayClock: "0:00", period: 0, type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false, shortDetail: "10/11 - 1:00 PM EDT" }, isTBDFlex: false },
        broadcasts: [{ type: { id: "1", shortName: "TV" }, market: { id: "1", type: "National" }, media: { shortName: "FOX" } }],
        competitors: [
          { id: "16", homeAway: "home", team: schedTeam("16", "MIN", "Minnesota Vikings", "min") },
          { id: "11", homeAway: "away", team: schedTeam("11", "IND", "Indianapolis Colts", "ind") }
        ]
      }]
    },
    {
      id: "401873099", date: "2026-10-18T17:00Z", name: "Minnesota Vikings at Chicago Bears", shortName: "MIN @ CHI",
      competitions: [{
        status: { type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false } },
        competitors: [
          { id: "3", homeAway: "home", team: schedTeam("3", "CHI", "Chicago Bears", "chi") },
          { id: "16", homeAway: "away", team: schedTeam("16", "MIN", "Minnesota Vikings", "min") }
        ]
      }]
    }
  ]
};

// …/sports/soccer/uefa.nations/teams and …/football/nfl/teams
export const ESPN_TEAMS = {
  sports: [{ leagues: [{ teams: [
    { team: { abbreviation: "ARI", alternateColor: "ffffff", color: "a40227", displayName: "Arizona Cardinals", id: "22", isActive: true, location: "Arizona", name: "Cardinals", nickname: "Cardinals", shortDisplayName: "Cardinals", slug: "arizona-cardinals", uid: "s:20~l:28~t:22",
      logos: [
        { alt: "", height: 500, href: "https://a.espncdn.com/i/teamlogos/nfl/500/ari.png", rel: ["full", "default"], width: 500 },
        { alt: "", height: 500, href: "https://a.espncdn.com/i/teamlogos/nfl/500-dark/ari.png", rel: ["full", "dark"], width: 500 },
        { alt: "", height: 500, href: "https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/ari.png", rel: ["full", "scoreboard"], width: 500 }
      ] } },
    { team: { abbreviation: "ALB", alternateColor: "ffffff", color: "E70000", displayName: "Albania", id: "585", isActive: true, location: "Albania", name: "Albania", shortDisplayName: "Albania", slug: "alb", uid: "s:600~t:585",
      logos: [{ alt: "", height: 500, href: "https://a.espncdn.com/i/teamlogos/countries/500/alb.png", rel: ["full", "default"], width: 500 }] } }
  ] }] }]
};

// thesportsdb.com/api/v1/json/<key>/eventsday.php?d=2026-10-04&l=4391
export const TSDB_EVENTSDAY = {
  events: [
    {
      idEvent: "2475423", strTimestamp: "2026-10-04T13:30:00", strEvent: "Washington Commanders vs Indianapolis Colts", strSport: "American Football",
      idLeague: "4391", strLeague: "NFL", strSeason: "2026", strHomeTeam: "Washington Commanders", strAwayTeam: "Indianapolis Colts",
      intHomeScore: "13", intAwayScore: "30", intRound: "4", dateEvent: "2026-10-04", strTime: "13:30:00", strGroup: "",
      idHomeTeam: "134937", strHomeTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/rn0c7v1643826119.png",
      idAwayTeam: "134927", strAwayTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/im99lm1784651201.png",
      strVenue: "Tottenham Hotspur Stadium", strStatus: "FT", strPostponed: "no"
    },
    // SYNTHETIC: not started, and an evening game filed under the next UTC day.
    {
      idEvent: "2475430", strTimestamp: "2026-10-04T20:25:00", strHomeTeam: "Minnesota Vikings", strAwayTeam: "Detroit Lions", intHomeScore: null, intAwayScore: null,
      dateEvent: "2026-10-04", strTime: "20:25:00", idHomeTeam: "134941", idAwayTeam: "134939", strStatus: "NS", strPostponed: "no"
    }
  ]
};
export const TSDB_EVENTSDAY_NEXT = {
  events: [
    {
      idEvent: "2475440", strTimestamp: "2026-10-05T00:20:00", strHomeTeam: "Buffalo Bills", strAwayTeam: "Kansas City Chiefs", intHomeScore: null, intAwayScore: null,
      dateEvent: "2026-10-05", strTime: "00:20:00", idHomeTeam: "134918", idAwayTeam: "134931", strStatus: "NS", strPostponed: "no"
    },
    {
      idEvent: "2475450", strTimestamp: "2026-10-06T00:15:00", strHomeTeam: "Seattle Seahawks", strAwayTeam: "Dallas Cowboys", intHomeScore: null, intAwayScore: null,
      dateEvent: "2026-10-06", strTime: "00:15:00", idHomeTeam: "134949", idAwayTeam: "134923", strStatus: "NS", strPostponed: "no"
    }
  ]
};
