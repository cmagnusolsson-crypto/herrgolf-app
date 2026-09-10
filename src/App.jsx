import { useState, useMemo, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/* =====================================================
   UI KOMPONENTER
===================================================== */

const Page = ({ children }) => (
  <div style={{
    minHeight: "100vh",
    background: "#111",
    display: "flex",
    justifyContent: "center",
    padding: 12
  }}>
    <div style={{
      width: "100%",
      maxWidth: 480,
      background: "#eaf5ee",
      borderRadius: 12,
      padding: 12
    }}>
      {children}
    </div>
  </div>
);

const Card = ({ children }) => (
  <div style={{
    background: "#fff",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    boxShadow: "0 2px 6px rgba(0,0,0,.1)"
  }}>
    {children}
  </div>
);

const Button = ({ children, ...props }) => (
  <button
    {...props}
    style={{
      padding: "6px 10px",
      borderRadius: 6,
      border: "1px solid #999",
      background: "#f2f2f2",
      cursor: "pointer",
      fontSize: 13,
      whiteSpace: "nowrap",

      position: "relative",
      zIndex: 10,          // 👈 Tvingar knappen över allt annat
      pointerEvents: "auto"
    }}
  >
    {children}
  </button>
);


const Input = (props) => (
  <input
    {...props}
    style={{
      width: "100%",
      padding: 6,
      borderRadius: 6,
      border: "1px solid #ccc",
      fontSize: 13
    }}
  />
);

/* =====================================================
   KONFIG
===================================================== */

const ROUNDS = 17;
const STORAGE_KEY = "herrgolf_state";
const BACKUP_KEY = "herrgolf_backup";

const CLUB_NAME = "Hammarö GK";
const CLUB_PRIMARY = "#0f6d3b";
const CLUB_LOGO = "/logo.png";

const ADMIN_PASSWORD = "HammaroGK26";
const roundName = (n) =>
  n === 17 ? "Shoot-Out" : `Herrgolf #${n}`;
const GOLF_ID_REGEX = /^\d{6}-\d{3}$/;

/* =====================================================
   HJÄLPFUNKTIONER
===================================================== */

const calculatePoints = (place, net, roundNumber) => {
  const p = Number(net);

  // Diskad
  if (p === 999) return 0;

  // Topp 6
  const top6 = [10, 8, 6, 5, 4, 3];
  if (place >= 1 && place <= 6) {
    return top6[place - 1];
  }

  // Rond 14–16 spelas över 9 hål
  // Plats 7 och nedåt:
  // 38 slag eller bättre = 2 poäng
  // över 38 slag = 1 poäng
  if (roundNumber >= 14 && roundNumber <= 16) {
    return p <= 38 ? 2 : 1;
  }

  // Rond 1–13, 18 hål
  // 75 slag eller bättre = 2 poäng
  // över 75 slag = 1 poäng
  return p <= 75 ? 2 : 1;
};


// ===== SHOOT-OUT POÄNG =====
const calculateShootOutPoints = (place) => {
  const p = Number(place);

  if (p === 1) return 15;
  if (p === 2) return 12;
  if (p >= 3 && p <= 4) return 10;
  if (p >= 5 && p <= 6) return 8;
  if (p >= 7 && p <= 8) return 6;
  if (p >= 9 && p <= 12) return 4;
  if (p >= 13 && p <= 16) return 3;
  if (p >= 17 && p <= 20) return 2;
  if (p >= 21 && p <= 25) return 1;

  return 0;
};


function assignClasses(players) {
  const sorted = [...players].sort((a, b) => a.hcp - b.hcp);
  const half = Math.ceil(sorted.length / 2);

  return players.map((p) => {
    const idx = sorted.findIndex((s) => s.golfId === p.golfId);
    return { ...p, class: idx < half ? "A" : "B" };
  });
}

/* =====================================================
   APP
===================================================== */

export default function App() {

  const fileRef = useRef(null);
  const resultRef = useRef(null);

  const emptyRounds = Array.from({ length: ROUNDS }).map(() => ({
    participants: [],
    results: [],
    locked: false,
    prizes: { A: [], B: [] }
  }));

  // ✅ Flytta hit denna
  const [rounds, setRounds] = useState(emptyRounds);
  const [storageLoaded, setStorageLoaded] = useState(false);

const restoreBackup = () => {
  const ok = window.confirm(
    "⚠️ ÅTERSTÄLLNING\n\nDetta rensar ALL data:\n• Alla deltävlingar\n• Startlistor\n• Resultat\n• Totalställning\n\nVill du fortsätta?"
  );
  if (!ok) return;

  const resetRounds = Array.from({ length: ROUNDS }).map(() => ({
    participants: [],
    results: [],
    locked: false,
    prizes: { A: [], B: [] }
  }));

  setRounds(resetRounds);

  // Rensa sparad data
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(BACKUP_KEY);

  alert("✅ All tävlingsdata är nu rensad.");
};

  const [currentRound, setCurrentRound] = useState(1);
  const [classFilter, setClassFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  const [loggedIn, setLoggedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [playerView, setPlayerView] = useState(false);

  const current = rounds[currentRound - 1];

const clearCurrentRound = () => {
  const ok = window.confirm(
    `Vill du rensa deltävling #${currentRound}? All data i denna rond tas bort.`
  );
  if (!ok) return;

  setRounds((prev) => {
    const copy = [...prev];

    copy[currentRound - 1] = {
      ...copy[currentRound - 1],
      participants: [],
      results: [],
      locked: false
    };

    return copy;
  });

  alert(`Deltävling #${currentRound} är nu rensad ✅`);
};

const updateMoney = (golfId, value) => {
  setRounds(prev => {
    const copy = [...prev];
    const round = copy[currentRound - 1];

    if (round.locked) return prev; // 🔒 BLOCKERA

    round.results = round.results.map(r =>
      r.golfId === golfId
        ? { ...r, money: Number(value) }
        : r
    );

    return copy;
  });
};


  /* ================= LAGRING ================= */

useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "player") setPlayerView(true);

  const saved = localStorage.getItem(STORAGE_KEY);
  const backup = localStorage.getItem(BACKUP_KEY);

  let loadedRounds = null;

  try {
    if (saved) {
      loadedRounds = JSON.parse(saved);
    } else if (backup) {
      loadedRounds = JSON.parse(backup);
    }
  } catch (error) {
    console.error("Kunde inte läsa sparad tävlingsdata:", error);
  }

  if (Array.isArray(loadedRounds)) {
    // Behåll all gammal data och lägg till tomma rundor om det saknas,
    // exempelvis när vi går från 16 till 17 rundor.
    const normalizedRounds = Array.from(
      { length: ROUNDS },
      (_, index) => {
        if (loadedRounds[index]) {
          return {
            participants: [],
            results: [],
            locked: false,
            prizes: { A: [], B: [] },
            ...loadedRounds[index]
          };
        }

        return {
          participants: [],
          results: [],
          locked: false,
          prizes: { A: [], B: [] }
        };
      }
    );

    setRounds(normalizedRounds);
  }

  setStorageLoaded(true);
}, []);

useEffect(() => {
  // Spara inte innan gammal data har lästs in.
  if (!storageLoaded) return;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(rounds));
  localStorage.setItem(BACKUP_KEY, JSON.stringify(rounds));
}, [rounds, storageLoaded]);

  /* ================= EXCEL ================= */

  const readExcel = async (file) => {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" });
  };

  const importParticipants = async (file) => {
    if (current.locked) return alert("Ronden är låst.");
    const rows = await readExcel(file);

    const parsed = rows.map((r) => ({
      name: String(r.Namn || r.namn || "").trim(),
      golfId: String(r["Golf-ID"] || r.golfId || "").trim(),
      hcp: Number(r.HCP || r.hcp || 0),
      shcp: Number(r.SHCP || r.shcp || 0),
      net: ""
    })).filter(p => GOLF_ID_REGEX.test(p.golfId));

    const withClass = assignClasses(parsed);

    setRounds(prev => {
      const copy = [...prev];
      copy[currentRound - 1].participants = withClass;
      copy[currentRound - 1].results = [];
      return copy;
    });
  };

  const importResults = async (file) => {
    if (current.locked) return alert("Ronden är låst.");
    const rows = await readExcel(file);

    setRounds(prev => {
      const copy = [...prev];
      const round = copy[currentRound - 1];

      round.participants = round.participants.map(p => {
        const match = rows.find(r =>
          String(r["Golf-ID"] || r.golfId || "").trim() === p.golfId
        );
        if (!match) return p;
        return { ...p, net: Number(match.Netto || match.netto || 0) };
      });

      return copy;
    });
  };

  /* ================= RESULTAT ================= */

  const generateResults = () => {
    if (current.locked) return alert("Ronden är låst.");

    setRounds(prev => {
      const copy = [...prev];
      const part = copy[currentRound - 1].participants;

// ===== SHOOT-OUT – OMGÅNG 17 =====
if (currentRound === 17) {
  const shootOutResults = part
    .filter(p => p.net !== "")
    .map(p => ({
      ...p,
      place: Number(p.net),
      points: calculateShootOutPoints(Number(p.net)),
      class: "SO",
      money: 0
    }))
    .filter(p => p.place >= 1 && p.place <= 25)
    .sort((a, b) => a.place - b.place);

  copy[currentRound - 1].results = shootOutResults;
  return copy;
}

      const results = ["A","B"].flatMap(klass => {
        const list = part
          .filter(p => p.class === klass && p.net !== "")
          .sort((a, b) => {
  // Diskade (999) sist
  if (a.net === 999 && b.net === 999) return 0;
  if (a.net === 999) return 1;
  if (b.net === 999) return -1;

  // 1) Netto (lägst först)
  if (a.net !== b.net) return a.net - b.net;

  // 2) TIE-BREAK: bästa HCP överst (lägst HCP vinner)
  return a.hcp - b.hcp;
});



        return list.map((p, idx) => ({
 	  ...p,
  	  place: idx + 1,
  	  points: calculatePoints(idx + 1, p.net, currentRound),
  	  prize: 0   // pengar sätts manuellt i UI
	}));

      });

      copy[currentRound - 1].results = results;
      return copy;
    });
  };

  const totals = useMemo(() => {
  const map = {};
  rounds.forEach(r =>
    r.results.forEach(res => {
      if (!map[res.golfId]) {
        map[res.golfId] = {
          ...res,
          total: 0,
          money: 0
        };
      }

      // ✅ Uppdatera alltid till senaste handicap
      map[res.golfId].hcp = res.hcp;
      map[res.golfId].shcp = res.shcp;

      map[res.golfId].total += res.points;
      map[res.golfId].money += res.money || 0;
    })
  );

  return Object.values(map).sort((a, b) => {
    // 1) Poäng
    if (b.total !== a.total) return b.total - a.total;
    // 2) Tie-break: bästa HCP (lägst)
    return a.hcp - b.hcp;
  });
}, [rounds]);


  /* ================= SORTERING ================= */

  const visibleParticipants = current.participants
    .filter(p => classFilter === "ALL" || p.class === classFilter)
    .sort((a,b) => {
      let v = 0;
      if (sortKey === "name") v = a.name.localeCompare(b.name);
      if (sortKey === "hcp") v = a.hcp - b.hcp;
      if (sortKey === "class") v = a.class.localeCompare(b.class);
      return sortDir === "asc" ? v : -v;
    });

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  /* ================= EXPORT ================= */

const exportExcel = () => {
  const wb = XLSX.utils.book_new();

  rounds.forEach((r, i) => {
    const ws = XLSX.utils.json_to_sheet(r.results);

    const sheetName =
      i === 16 ? "Shoot-Out" : `Rond ${i + 1}`;

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  const totalWs = XLSX.utils.json_to_sheet(totals);
  XLSX.utils.book_append_sheet(wb, totalWs, "Total");

  XLSX.writeFile(wb, "herrgolf.xlsx");
};

const buildTotalTableRows = () => {
  const players = {};

  rounds.forEach((round, roundIndex) => {
    round.results.forEach(res => {
      if (!players[res.golfId]) {
        players[res.golfId] = {
          golfId: res.golfId,
          name: res.name,
          hcp: res.hcp,
          shcp: res.shcp,
          pointsPerRound: Array(ROUNDS).fill(""),
          total: 0,
          money: 0,
          roundsPlayed: 0
        };
      }

      // senaste handicap
      players[res.golfId].hcp = res.hcp;
      players[res.golfId].shcp = res.shcp;

      // poäng per rond
      players[res.golfId].pointsPerRound[roundIndex] = res.points;

      // summeringar
      players[res.golfId].total += res.points;
      players[res.golfId].money += res.money || 0;

// Räkna deltagande endast för ordinarie Herrgolf #1–16.
// Shoot-Out (#17) ger poäng men ökar inte Delt.
if (roundIndex < 16 && res.points > 0) {
  players[res.golfId].roundsPlayed += 1;
}
    });
  });

  const sorted = Object.values(players).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.hcp - b.hcp;
  });

  return sorted.map((p, index) => ([
    index + 1,
    p.name,
    p.hcp,
    p.shcp,
    p.roundsPlayed,
    ...p.pointsPerRound,
    p.total,
    p.money
  ]));
};

const chunk = (arr, size) => {
  const res = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
};

let cachedLogoBase64 = null;

const loadImageAsBase64 = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = url;
  });

const exportCompetitionPDF = async (mode) => {
  const isTotal = mode === "TOTAL";

  const doc = new jsPDF(isTotal ? "l" : "p", "mm", "a4");
  const marginX = isTotal ? 10 : 15;
  const TITLE_Y = 26;   // 👈 rubriken hamnar snyggt under loggan
const TABLE_Y = 27;  // 👈 gröna rubriker startar strax under rubriken
let y = TABLE_Y;


const HEADER_HEIGHT = 34; // 👈 justera 26–30 tills det känns perfekt

// 🔥 Ladda logga EN gång innan PDF skapas
if (!cachedLogoBase64) {
  try {
    cachedLogoBase64 = await loadImageAsBase64("/logo.png");
  } catch (e) {
    console.warn("Kunde inte ladda logga i PDF:", e);
  }
}

const drawHeader = () => {
  if (!cachedLogoBase64) return;

  const pageWidth = doc.internal.pageSize.getWidth();

  const logoSize = 23;
  const paddingRight = 10;
  const yLogo = 6;
  const x = pageWidth - logoSize - paddingRight;

  doc.addImage(cachedLogoBase64, "PNG", x, yLogo, logoSize, logoSize);

  // 👇 Rubrik på varje sida
  doc.setFontSize(16);

  if (mode === "TOTAL") {
    doc.text(`Totalställning – Herrgolf 2026`, marginX, TITLE_Y);
  }
  if (mode === "A") {
    doc.text(`Resultat – Klass A – Herrgolf #${currentRound}`, marginX, TITLE_Y);
  }
  if (mode === "B") {
    doc.text(`Resultat – Klass B – Herrgolf #${currentRound}`, marginX, TITLE_Y);
  }
};


  // 👇 autoTable + didDrawPage: () => drawHeader()

  const totalHead = [
    "Plac",
    "Namn",
    "HCP",
    "SHCP",
    "Delt.",
    ...Array.from(
  { length: ROUNDS },
  (_, i) => i === 16 ? "SO" : `H#${i + 1}`
),
    "Total",
    "Pengar"
  ];

  const classHead = [
    "Plac",
    "Namn",
    "HCP",
    "SHCP",
    "Netto",
    "Poäng",
    "Pengar"
  ];

  const classA = current.results.filter(r => r.class === "A");
  const classB = current.results.filter(r => r.class === "B");

  const mapRows = list =>
    list.map(r => [
      r.net === 999 ? "❌" : r.place,
      r.name,
      r.hcp,
      r.shcp,
      r.net === 999 ? "" : r.net,
      r.points,
      r.place <= 4 ? (r.money || "") : ""
    ]);

  // ===== TOTAL =====
if (mode === "TOTAL") {
  const totalRows = buildTotalTableRows();

  console.log("TOTAL ROWS:", totalRows.length);

  if (!totalRows || totalRows.length === 0) {
    alert("Ingen totalställning att exportera ännu.");
    return;
  }

autoTable(doc, {
  startY: Math.max(y, HEADER_HEIGHT),
  margin: {
    left: marginX,
    right: marginX,
    top: HEADER_HEIGHT   // 🔥 Detta gäller för sida 2, 3, 4...
  },
  styles: { fontSize: 7.5, cellPadding: 1 },
  head: [[
    "Plac",
    "Namn",
    "HCP",
    "SHCP",
    "Delt.",
    ...Array.from(
  { length: ROUNDS },
  (_, i) => i === 16 ? "SO" : `H#${i + 1}`
),
    "Total",
    "Pengar"
  ]],
 headStyles: {
      fillColor: [15, 109, 59],   // Hammarö GK mörkgrön
      textColor: 255
    },
  body: totalRows,

 didDrawPage: () => {
    drawHeader();
  },
  didParseCell: (data) => {
    // 🔥 Fet stil för topp 10 (radindex 0–9)
    if (data.section === "body" && data.row.index <= 9) {
      data.cell.styles.fontStyle = "bold";
    }
    // ➖ Tjock linje under topp 10 (radindex 9)
    if (data.section === "body" && data.row.index === 9) {
      data.cell.styles.lineWidth = { bottom: 1.5 };
      data.cell.styles.lineColor = [0, 0, 0];
    }
    // ➖ Tjock svart linje under topp 25 (radindex 24)
    if (data.section === "body" && data.row.index === 24) {
      data.cell.styles.lineWidth = { bottom: 1.5 };
      data.cell.styles.lineColor = [0, 0, 0];
    }
  }
});

  doc.save(`herrgolf_TOTAL_${currentRound}.pdf`);
  return;
}

  // ===== KLASS A =====
if (mode === "A") {
 autoTable(doc, {
  startY: Math.max(y, HEADER_HEIGHT),
  margin: {
    left: marginX,
    right: marginX,
    top: HEADER_HEIGHT   // 🔥 Detta gäller för sida 2, 3, 4...
  },
    styles: { fontSize: 7.5, cellPadding: 1 },
    head: [classHead],
    headStyles: {
      fillColor: [15, 109, 59],   // Hammarö GK mörkgrön
      textColor: 255
    },
    body: mapRows(classA),

  didDrawPage: () => {
      drawHeader();
    },

    didParseCell: (data) => {
      // 🔥 Fet stil för topp 6 (radindex 0–5)
      if (data.section === "body" && data.row.index <= 5) {
        data.cell.styles.fontStyle = "bold";
      }

      // ➖ Tjock linje under topp 6 (radindex 5)
      if (data.section === "body" && data.row.index === 5) {
        data.cell.styles.lineWidth = { bottom: 1.5 };
        data.cell.styles.lineColor = [0, 0, 0];
      }
    }
  });

  doc.save(`herrgolf_A_${currentRound}.pdf`);
  return;
}


  // ===== KLASS B =====
if (mode === "B") {
autoTable(doc, {
  startY: Math.max(y, HEADER_HEIGHT),
  margin: {
    left: marginX,
    right: marginX,
    top: HEADER_HEIGHT   // 🔥 Detta gäller för sida 2, 3, 4...
  },
    styles: { fontSize: 7.5, cellPadding: 1 },
    head: [classHead],
 headStyles: {
      fillColor: [15, 109, 59],   // Hammarö GK mörkgrön
      textColor: 255
    },
    body: mapRows(classB),

  didDrawPage: () => {
      drawHeader();
    },

    didParseCell: (data) => {
      // 🔥 Fet stil för topp 6 (radindex 0–5)
      if (data.section === "body" && data.row.index <= 5) {
        data.cell.styles.fontStyle = "bold";
      }

      // ➖ Tjock linje under topp 6 (radindex 5)
      if (data.section === "body" && data.row.index === 5) {
        data.cell.styles.lineWidth = { bottom: 1.5 };
        data.cell.styles.lineColor = [0, 0, 0];
      }
    }
  });

  doc.save(`herrgolf_B_${currentRound}.pdf`);
  return;
}


};

// ===== SHOOT-OUT PDF =====
const exportShootOutPDF = async () => {
  const shootOutResults = rounds[16]?.results
    ?.filter(r => r.class === "SO")
    ?.sort((a, b) => a.place - b.place);

  if (!shootOutResults || shootOutResults.length === 0) {
    alert("Inget Shoot-Out-resultat att exportera ännu.");
    return;
  }

  const doc = new jsPDF("p", "mm", "a4");

  // Ladda Hammarö GK-loggan
  if (!cachedLogoBase64) {
    try {
      cachedLogoBase64 = await loadImageAsBase64("/logo.png");
    } catch (e) {
      console.warn("Kunde inte ladda logga i Shoot-Out PDF:", e);
    }
  }

  // Logga uppe till höger
  if (cachedLogoBase64) {
    doc.addImage(cachedLogoBase64, "PNG", 172, 7, 25, 25);
  }

  // Rubrik
  doc.setFontSize(18);
  doc.text("Resultat – Shoot-Out 2026", 15, 25);

  // Resultatrader: Plac | Namn | Poäng
  const rows = shootOutResults.map(r => [
    r.place,
    r.name,
    `${r.points} p`
  ]);

  autoTable(doc, {
    startY: 36,
    head: [["Plac", "Namn", "Poäng"]],
    body: rows,

    headStyles: {
      fillColor: [15, 109, 59],
      textColor: 255,
      lineWidth: 0
    },

    // Inga linjer mellan spelarna
    styles: {
      fontSize: 7.5,
      cellPadding: 1,
      lineWidth: 0
    },

    bodyStyles: {
      lineWidth: 0
    },

    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 110 },
      2: { cellWidth: 30 }
    },

 // Poängen i fetstil + vinnaren i fetstil
didParseCell: (data) => {
  if (data.section === "body") {

    // Vinnaren – hela raden i fetstil
    if (data.row.index === 0) {
      data.cell.styles.fontStyle = "bold";
    }

    // Poäng – fetstil för alla spelare
    if (data.column.index === 2) {
      data.cell.styles.fontStyle = "bold";
    }
  }
}
  });

  doc.save("Shoot-Out_2026.pdf");
};

  const publicLink = `${window.location.origin}${window.location.pathname}?view=player`;


  /* ================= LOGIN ================= */

  if (!loggedIn && !playerView) {
    return (
      <Page>
        <Card>
          <img src={CLUB_LOGO} alt="logo" style={{ width:120, margin:"0 auto", display:"block" }} />
          <h3 style={{ textAlign:"center" }}>Admin inloggning</h3>
          <Input
            type="password"
            placeholder="Lösenord"
            value={password}
            onChange={(e)=>setPassword(e.target.value)}
          />
          <Button onClick={()=>{
            if(password === ADMIN_PASSWORD) setLoggedIn(true);
            else alert("Fel lösenord");
          }}>
            Logga in
          </Button>
          <Button onClick={()=>setPlayerView(true)}>
            👀 Spelarvy
          </Button>
        </Card>
      </Page>
    );
  }

  /* ================= UI ================= */

  return (
    <Page>

      <img src={CLUB_LOGO} alt="logo" style={{ width:160, margin:"0 auto", display:"block" }} />

      <h2 style={{ color:CLUB_PRIMARY, textAlign:"center" }}>
        {CLUB_NAME} – {roundName(currentRound)}
      </h2>

      {/* Deltävling */}
      <div>
        Deltävling:
        <select value={currentRound} onChange={e => setCurrentRound(Number(e.target.value))}>
          {Array.from({length:ROUNDS}).map((_,i)=>(
            <option key={i} value={i+1}>
  {i === 16 ? "Shoot-Out" : `#${i + 1}`}
</option>
          ))}
        </select>
      </div>

      {/* Knappar */}
      {!playerView && (
        <div
  style={{
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    margin: "8px 0",
    position: "relative",
    zIndex: 5
  }}
>

          <Button onClick={()=>fileRef.current.click()}>📥 Startlista</Button>
          <Button onClick={()=>resultRef.current.click()}>📥 Resultat</Button>
          <Button onClick={generateResults}>🏁 Skapa</Button>
          <Button onClick={exportExcel}>📊 Excel</Button>
          {currentRound === 17 && (
            <Button onClick={exportShootOutPDF}>📄 PDF Shoot-Out</Button>
          )}
<Button onClick={() => {
  console.log("PDF TOTAL klickad");
  exportCompetitionPDF("TOTAL");
}}>
  📄 PDF Total
</Button>

<Button onClick={() => {
  console.log("PDF A klickad");
  exportCompetitionPDF("A");
}}>
  📄 PDF A
</Button>

<Button onClick={() => {
  console.log("PDF B klickad");
  exportCompetitionPDF("B");
}}>
  📄 PDF B
</Button>
	  <Button onClick={clearCurrentRound}>🧹 Rensa deltävling</Button>
          <Button onClick={restoreBackup}>♻️ Återställ</Button>
          <Button onClick={()=>{
            setRounds(prev=>{
              const copy=[...prev];
              copy[currentRound-1].locked=!copy[currentRound-1].locked;
              return copy;
            });
          }}>
            {current.locked?"🔓 Lås upp":"🔒 Lås"}
          </Button>
        </div>
      )}

      {/* Publik länk */}
      {!playerView && (
        <Card>
          <strong>Publik länk:</strong>
          <div style={{ fontSize:12 }}>{publicLink}</div>
        </Card>
      )}

      <input hidden ref={fileRef} type="file" accept=".xlsx" onChange={e=>importParticipants(e.target.files[0])}/>
      <input hidden ref={resultRef} type="file" accept=".xlsx" onChange={e=>importResults(e.target.files[0])}/>

      {/* Filter */}
      <div>
        Klass:
        <select value={classFilter} onChange={e=>setClassFilter(e.target.value)}>
          <option value="ALL">Alla</option>
          <option value="A">A</option>
          <option value="B">B</option>
        </select>
      </div>

      {/* Startlista */}
      <Card>
        <strong>Startlista</strong>
        <div style={{ fontSize:12 }}>
          <Button onClick={()=>toggleSort("name")}>Namn</Button>
          <Button onClick={()=>toggleSort("hcp")}>HCP</Button>
          <Button onClick={()=>toggleSort("class")}>Klass</Button>
        </div>

        {visibleParticipants.map((p,i)=>(
          <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 70px 40px 40px 40px 60px", fontSize:11 }}>
            <div>{p.name}</div>
            <div>{p.golfId}</div>
            <div>{p.hcp}</div>
            <div>{p.shcp}</div>
            <div>{p.class}</div>
<input
  disabled={current.locked || playerView}
  value={p.net}
  placeholder={currentRound === 17 ? "Plac" : "Netto"}
  onChange={e=>{
    const v = e.target.value;

    setRounds(prev => {
      const copy = [...prev];

      const playerIndex =
        copy[currentRound - 1].participants.findIndex(
          player => player.golfId === p.golfId
        );

      if (playerIndex !== -1) {
        copy[currentRound - 1].participants[playerIndex].net = v;
      }

      return copy;
    });
  }}
/>
          </div>
        ))}
      </Card>

{/* Resultat */}

{currentRound !== 17 && ["A","B"].map(klass=>(
  <Card key={klass}>
    <strong>Resultat – Klass {klass}</strong>

    {current.results.filter(r => r.class === klass).map((r, i) => (
      <div
        key={i}
        style={{
          fontSize: 12,
          display: "grid",
          gridTemplateColumns: "40px 1fr 50px 50px 60px 60px 80px",
          alignItems: "center",
          gap: 6
        }}
      >

        {/* Placering / Diskad */}
        <div>
          {r.net === 999 ? (
            <span style={{ color: "red", fontWeight: "bold" }}>❌</span>
          ) : (
            r.place
          )}
        </div>

        {/* Namn */}
        <div>{r.name}</div>

        {/* HCP */}
        <div>{r.hcp}</div>

        {/* SHCP */}
        <div>{r.shcp}</div>

        {/* Netto (dölj för diskad) */}
        <div>{r.net === 999 ? "" : r.net}</div>

        {/* Poäng */}
        <div>{r.points}p</div>

        {/* Pengar – endast topp 4 */}
        <div>
          {r.place <= 4 && r.net !== 999 ? (
            <input
              type="number"
              value={r.money ?? ""}
              placeholder="kr"
              style={{ width: 70 }}
              onChange={(e) =>
                updateMoney(r.golfId, e.target.value)
              }
            />
          ) : (
            ""
          )}
        </div>

      </div>
    ))}

  </Card>
))}


{/* SHOOT-OUT RESULTAT */}
{currentRound === 17 && (
  <Card>
    <strong>Resultat – Shoot-Out</strong>

    {current.results
      .filter(r => r.class === "SO")
      .map((r, i) => (
        <div
          key={i}
          style={{
            fontSize: 12,
            display: "grid",
            gridTemplateColumns: "60px 1fr 80px",
            alignItems: "center",
            gap: 6,
            padding: "4px 0"
          }}
        >
          <div>{r.place}</div>

          <div>{r.name}</div>

          <div style={{ fontWeight: "bold" }}>
            {r.points}p
          </div>
        </div>
      ))}

  </Card>
)}

      {/* Total */}
      <Card>
        <strong>Totalställning</strong>
        {totals.map((t,i)=>(
          <div key={i} style={{ fontSize:12, display:"flex", justifyContent:"space-between" }}>
            <span>{i+1}. {t.name}</span>
            <span>{t.total} p | {t.money} kr</span>
          </div>
        ))}
      </Card>

    </Page>
  );
}
