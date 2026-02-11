// ================== App.jsx ==================
import { useState, useMemo, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/* =====================================================
   UI KOMPONENTER
===================================================== */

const Page = ({ children }) => (
  <div style={{ minHeight: "100vh", background: "#111", display: "flex", justifyContent: "center", padding: 12 }}>
    <div style={{ width: "100%", maxWidth: 480, background: "#eaf5ee", borderRadius: 12, padding: 12 }}>
      {children}
    </div>
  </div>
);

const Card = ({ children }) => (
  <div style={{ background: "#fff", borderRadius: 10, padding: 12, marginBottom: 12, boxShadow: "0 2px 6px rgba(0,0,0,.1)" }}>
    {children}
  </div>
);

const Button = ({ children, ...props }) => (
  <button {...props} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #999", background: "#f2f2f2", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap", position: "relative", zIndex: 10 }}>
    {children}
  </button>
);

const Input = (props) => (
  <input {...props} style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }} />
);

/* =====================================================
   KONFIG
===================================================== */

const ROUNDS = 16;
const STORAGE_KEY = "herrgolf_state";
const BACKUP_KEY = "herrgolf_backup";

const CLUB_NAME = "Hammarö GK";
const CLUB_PRIMARY = "#0f6d3b";
const CLUB_LOGO = "https://www.hammarogk.se/media/k2mkxwg0/hammarogk-logo.png?height=240";

const ADMIN_PASSWORD = "HammaroGK26";
const roundName = (n) => `Herrgolf #${n}`;
const GOLF_ID_REGEX = /^\d{6}-\d{3}$/;

/* =====================================================
   HJÄLPFUNKTIONER
===================================================== */

const calculatePoints = (place, net) => {
  const p = Number(net);
  if (p === 999) return 0;
  const top6 = [10, 8, 6, 5, 4, 3];
  if (place >= 1 && place <= 6) return top6[place - 1];
  if (p <= 75) return 2;
  return 1;
};

const chunk = (arr, size) => {
  const res = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
};

function assignClasses(players) {
  const sorted = [...players].sort((a, b) => a.hcp - b.hcp);
  const half = Math.ceil(sorted.length / 2);
  return players.map(p => ({ ...p, class: sorted.findIndex(s => s.golfId === p.golfId) < half ? "A" : "B" }));
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
    locked: false
  }));

  const [rounds, setRounds] = useState(emptyRounds);
  const [currentRound, setCurrentRound] = useState(1);
  const [classFilter, setClassFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [loggedIn, setLoggedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [playerView, setPlayerView] = useState(false);

  const current = rounds[currentRound - 1];

  const restoreBackup = () => {
    if (!window.confirm("⚠️ ÅTERSTÄLLNING\n\nAll data rensas. Fortsätt?")) return;
    setRounds(emptyRounds);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(BACKUP_KEY);
    alert("✅ All tävlingsdata rensad.");
  };

  const clearCurrentRound = () => {
    if (!window.confirm(`Vill du rensa deltävling #${currentRound}?`)) return;
    setRounds(prev => {
      const copy = [...prev];
      copy[currentRound - 1] = { ...copy[currentRound - 1], participants: [], results: [], locked: false };
      return copy;
    });
  };

  const updateMoney = (golfId, value) => {
    setRounds(prev => {
      const copy = [...prev];
      const round = copy[currentRound - 1];
      if (round.locked) return prev;
      round.results = round.results.map(r => r.golfId === golfId ? { ...r, money: Number(value) } : r);
      return copy;
    });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "player") setPlayerView(true);
    const saved = localStorage.getItem(STORAGE_KEY);
    const backup = localStorage.getItem(BACKUP_KEY);
    if (saved) setRounds(JSON.parse(saved));
    else if (backup) setRounds(JSON.parse(backup));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rounds));
    localStorage.setItem(BACKUP_KEY, JSON.stringify(rounds));
  }, [rounds]);

  const readExcel = async (file) => {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" });
  };

  const importParticipants = async (file) => {
    if (current.locked) return alert("Ronden är låst.");
    const rows = await readExcel(file);
    const parsed = rows.map(r => ({
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
        const match = rows.find(r => String(r["Golf-ID"] || r.golfId || "").trim() === p.golfId);
        return match ? { ...p, net: Number(match.Netto || match.netto || 0) } : p;
      });
      return copy;
    });
  };

  const generateResults = () => {
    if (current.locked) return alert("Ronden är låst.");
    setRounds(prev => {
      const copy = [...prev];
      const part = copy[currentRound - 1].participants;

      const results = ["A", "B"].flatMap(klass => {
        const list = part.filter(p => p.class === klass && p.net !== "")
          .sort((a, b) => {
            if (a.net === 999 && b.net === 999) return 0;
            if (a.net === 999) return 1;
            if (b.net === 999) return -1;
            if (a.net !== b.net) return a.net - b.net;
            return a.hcp - b.hcp;
          });

        return list.map((p, idx) => ({
          ...p,
          place: idx + 1,
          points: calculatePoints(idx + 1, p.net),
          money: 0
        }));
      });

      copy[currentRound - 1].results = results;
      return copy;
    });
  };

  const totals = useMemo(() => {
    const map = {};
    rounds.forEach(r => r.results.forEach(res => {
      if (!map[res.golfId]) map[res.golfId] = { ...res, total: 0, money: 0 };
      map[res.golfId].hcp = res.hcp;
      map[res.golfId].shcp = res.shcp;
      map[res.golfId].total += res.points;
      map[res.golfId].money += res.money || 0;
    }));
    return Object.values(map).sort((a, b) => b.total - a.total || a.hcp - b.hcp);
  }, [rounds]);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    rounds.forEach((r, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r.results), `Rond ${i + 1}`));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(totals), "Total");
    XLSX.writeFile(wb, "herrgolf.xlsx");
  };

  const buildTotalTableRows = () => {
    const players = {};
    rounds.forEach((round, ri) => round.results.forEach(res => {
      if (!players[res.golfId]) players[res.golfId] = { name: res.name, hcp: res.hcp, shcp: res.shcp, total: 0, money: 0, pointsPerRound: Array(ROUNDS).fill("") };
      players[res.golfId].hcp = res.hcp;
      players[res.golfId].shcp = res.shcp;
      players[res.golfId].pointsPerRound[ri] = res.points;
      players[res.golfId].total += res.points;
      players[res.golfId].money += res.money || 0;
    }));
    const sorted = Object.values(players).sort((a, b) => b.total - a.total || a.hcp - b.hcp);
    return sorted.map((p, i) => [i + 1, p.name, p.hcp, p.shcp, ...p.pointsPerRound, p.total, p.money]);
  };

  const exportCompetitionPDF = (mode) => {
    const isTotal = mode === "TOTAL";
    const doc = new jsPDF(isTotal ? "l" : "p", "mm", "a4");
    const marginX = isTotal ? 10 : 15;
    let y = 18;

    doc.addImage("/logo-192.png", "PNG", marginX, y, 26, 26);
    doc.setFontSize(16);
    doc.text(`Hammarö GK – Herrgolf #${currentRound}`, marginX + 34, y + 16);
    y += 26;

    const totalHead = ["Plac", "Namn", "HCP", "SHCP", ...Array.from({ length: ROUNDS }, (_, i) => `H#${i + 1}`), "Total", "Pengar"];
    const classHead = ["Plac", "Namn", "HCP", "SHCP", "Netto", "Poäng", "Pengar"];

    const renderTable = (head, rows, pageIndex = 0) => {
      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        styles: { fontSize: isTotal ? 8 : 9, cellPadding: 2 },
        head: [head],
        body: rows,
        didDrawCell: (data) => {
          if (isTotal && pageIndex === 0 && data.section === "body" && data.row.index === 9 && data.column.index === 0) {
            const w = data.table.width;
            doc.setLineWidth(0.5);
            doc.line(data.table.startX, data.cell.y + data.cell.height, data.table.startX + w, data.cell.y + data.cell.height);
          }
        }
      });
      y = doc.lastAutoTable.finalY + 10;
    };

    if (mode === "TOTAL") {
  try {
    const rows = buildTotalTableRows();
    const pages = chunk(rows, 25);

    pages.forEach((page, i) => {
      if (i > 0) {
        doc.addPage("a4", "l");
        y = 18;
      }

      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        styles: { fontSize: 8, cellPadding: 2 },
        head: [[
          "Plac",
          "Namn",
          "HCP",
          "SHCP",
          ...Array.from({ length: ROUNDS }, (_, i) => `H#${i + 1}`),
          "Total",
          "Pengar"
        ]],
        body: page,

        didDrawCell: (data) => {
          if (
            i === 0 &&
            data.section === "body" &&
            data.row.index === 9 &&
            data.column.index === 0
          ) {
            const w = data.table.width;
            doc.setLineWidth(0.5);
            doc.line(
              data.table.startX,
              data.cell.y + data.cell.height,
              data.table.startX + w,
              data.cell.y + data.cell.height
            );
          }
        }
      });
    });

    doc.save(`herrgolf_TOTAL_${currentRound}.pdf`);
  } catch (err) {
    console.error("TOTAL PDF error:", err);
    alert("❌ Fel vid skapande av TOTAL-PDF. Se console.");
  }
}


    if (mode === "A" || mode === "B") {
      const rows = current.results.filter(r => r.class === mode).map(r => [
        r.net === 999 ? "❌" : r.place,
        r.name,
        r.hcp,
        r.shcp,
        r.net === 999 ? "" : r.net,
        r.points,
        r.place <= 4 ? (r.money || "") : ""
      ]);
      chunk(rows, 25).forEach((page, i) => {
        if (i > 0) { doc.addPage("a4", "p"); y = 18; }
        renderTable(classHead, page, i);
      });
    }

    doc.save(`herrgolf_${mode}_${currentRound}.pdf`);
  };

  // ================= UI =================

  if (!loggedIn && !playerView) {
    return (
      <Page>
        <Card>
          <img src={CLUB_LOGO} alt="logo" style={{ width: 120, margin: "0 auto", display: "block" }} />
          <h3 style={{ textAlign: "center" }}>Admin inloggning</h3>
          <Input type="password" placeholder="Lösenord" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button onClick={() => password === ADMIN_PASSWORD ? setLoggedIn(true) : alert("Fel lösenord")}>Logga in</Button>
          <Button onClick={() => setPlayerView(true)}>👀 Spelarvy</Button>
        </Card>
      </Page>
    );
  }

  const publicLink = `${window.location.origin}${window.location.pathname}?view=player`;

  return (
    <Page>
      <img src={CLUB_LOGO} alt="logo" style={{ width: 160, margin: "0 auto", display: "block" }} />
      <h2 style={{ color: CLUB_PRIMARY, textAlign: "center" }}>{CLUB_NAME} – {roundName(currentRound)}</h2>

      <div>
        Deltävling:
        <select value={currentRound} onChange={e => setCurrentRound(Number(e.target.value))}>
          {Array.from({ length: ROUNDS }).map((_, i) => <option key={i} value={i + 1}>#{i + 1}</option>)}
        </select>
      </div>

      {!playerView && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
          <Button onClick={() => fileRef.current.click()}>📥 Startlista</Button>
          <Button onClick={() => resultRef.current.click()}>📥 Resultat</Button>
          <Button onClick={generateResults}>🏁 Skapa</Button>
          <Button onClick={exportExcel}>📊 Excel</Button>
          <Button onClick={() => exportCompetitionPDF("TOTAL")}>📄 PDF Total</Button>
          <Button onClick={() => exportCompetitionPDF("A")}>📄 PDF A</Button>
          <Button onClick={() => exportCompetitionPDF("B")}>📄 PDF B</Button>
          <Button onClick={clearCurrentRound}>🧹 Rensa deltävling</Button>
          <Button onClick={restoreBackup}>♻️ Återställ</Button>
          <Button onClick={() => setRounds(prev => {
            const c = [...prev];
            c[currentRound - 1].locked = !c[currentRound - 1].locked;
            return c;
          })}>{current.locked ? "🔓 Lås upp" : "🔒 Lås"}</Button>
        </div>
      )}

      {!playerView && (
        <Card>
          <strong>Publik länk:</strong>
          <div style={{ fontSize: 12 }}>{publicLink}</div>
        </Card>
      )}

      <input hidden ref={fileRef} type="file" accept=".xlsx" onChange={e => importParticipants(e.target.files[0])} />
      <input hidden ref={resultRef} type="file" accept=".xlsx" onChange={e => importResults(e.target.files[0])} />

            {/* Filter */}
      <div>
        Klass:
        <select value={classFilter} onChange={e => setClassFilter(e.target.value)}>
          <option value="ALL">Alla</option>
          <option value="A">A</option>
          <option value="B">B</option>
        </select>
      </div>

      {/* Startlista */}
      <Card>
        <strong>Startlista</strong>
        <div style={{ fontSize: 12 }}>
          <Button onClick={() => toggleSort("name")}>Namn</Button>
          <Button onClick={() => toggleSort("hcp")}>HCP</Button>
          <Button onClick={() => toggleSort("class")}>Klass</Button>
        </div>

        {current.participants
          .filter(p => classFilter === "ALL" || p.class === classFilter)
          .sort((a, b) => {
            let v = 0;
            if (sortKey === "name") v = a.name.localeCompare(b.name);
            if (sortKey === "hcp") v = a.hcp - b.hcp;
            if (sortKey === "class") v = a.class.localeCompare(b.class);
            return sortDir === "asc" ? v : -v;
          })
          .map((p, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 70px 40px 40px 40px 60px", fontSize: 11 }}>
              <div>{p.name}</div>
              <div>{p.golfId}</div>
              <div>{p.hcp}</div>
              <div>{p.shcp}</div>
              <div>{p.class}</div>
              <input
                disabled={current.locked || playerView}
                value={p.net}
                onChange={e => {
                  const v = e.target.value;
                  setRounds(prev => {
                    const copy = [...prev];
                    copy[currentRound - 1].participants[i].net = v;
                    return copy;
                  });
                }}
              />
            </div>
          ))}
      </Card>

      {/* Resultat */}
      {["A", "B"].map(klass => (
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
              <div>{r.net === 999 ? <span style={{ color: "red", fontWeight: "bold" }}>❌</span> : r.place}</div>
              <div>{r.name}</div>
              <div>{r.hcp}</div>
              <div>{r.shcp}</div>
              <div>{r.net === 999 ? "" : r.net}</div>
              <div>{r.points}p</div>
              <div>
                {r.place <= 4 && r.net !== 999 ? (
                  <input
                    type="number"
                    value={r.money ?? ""}
                    placeholder="kr"
                    style={{ width: 70 }}
                    disabled={current.locked}
                    onChange={(e) => updateMoney(r.golfId, e.target.value)}
                  />
                ) : ""}
              </div>
            </div>
          ))}
        </Card>
      ))}

      {/* Total */}
      <Card>
        <strong>Totalställning</strong>
        {totals.map((t, i) => (
          <div key={i} style={{ fontSize: 12, display: "flex", justifyContent: "space-between" }}>
            <span>{i + 1}. {t.name}</span>
            <span>{t.total} p | {t.money} kr</span>
          </div>
        ))}
      </Card>

    </Page>
  );
}
