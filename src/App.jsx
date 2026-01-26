import { useState, useMemo, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

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
      whiteSpace: "nowrap"
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

const ROUNDS = 16;
const STORAGE_KEY = "herrgolf_state";
const BACKUP_KEY = "herrgolf_backup";

const CLUB_NAME = "Hammarö GK";
const CLUB_PRIMARY = "#0f6d3b";
const CLUB_LOGO =
  "https://www.hammarogk.se/media/k2mkxwg0/hammarogk-logo.png?height=240";

const ADMIN_PASSWORD = "HammaroGK26";
const roundName = (n) => `Herrgolf #${n}`;
const GOLF_ID_REGEX = /^\d{6}-\d{3}$/;

/* =====================================================
   HJÄLPFUNKTIONER
===================================================== */

function calculatePoints(place) {
  if (place === 1) return 10;
  if (place === 2) return 8;
  if (place === 3) return 6;
  if (place === 4) return 5;
  if (place === 5) return 4;
  if (place === 6) return 3;
  return 1;
}

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
    prizes: { A: [200,150,100,50,50], B: [200,150,100,50,50] }
  }));

  // ✅ Flytta hit denna
  const [rounds, setRounds] = useState(emptyRounds);

  // ✅ Restore-funktionen EFTER state
  const restoreBackup = () => {
    const backup = localStorage.getItem(BACKUP_KEY);
    if (!backup) {
      alert("Ingen backup hittades.");
      return;
    }

    const ok = window.confirm(
      "Vill du återställa senaste backup? Nuvarande data skrivs över."
    );
    if (!ok) return;

    try {
      const parsed = JSON.parse(backup);
      setRounds(parsed);
      alert("Backup återställd ✅");
    } catch (e) {
      alert("Kunde inte läsa backup.");
    }
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


  /* ================= LAGRING ================= */

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

      const results = ["A","B"].flatMap(klass => {
        const list = part
          .filter(p => p.class === klass && p.net !== "")
          .sort((a,b) => a.net - b.net);

        return list.map((p, idx) => ({
          ...p,
          place: idx + 1,
          points: calculatePoints(idx + 1),
          prize: copy[currentRound - 1].prizes[klass][idx] || 0
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
          map[res.golfId] = { ...res, total: 0, money: 0 };
        }
        map[res.golfId].total += res.points;
        map[res.golfId].money += res.prize || 0;
      })
    );
    return Object.values(map).sort((a,b) => b.total - a.total);
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
    rounds.forEach((r,i) => {
      const ws = XLSX.utils.json_to_sheet(r.results);
      XLSX.utils.book_append_sheet(wb, ws, `Rond ${i+1}`);
    });
    const totalWs = XLSX.utils.json_to_sheet(totals);
    XLSX.utils.book_append_sheet(wb, totalWs, "Total");
    XLSX.writeFile(wb, "herrgolf.xlsx");
  };

  const exportPDF = () => window.print();

  const exportPDFClass = (klass) => {
    setClassFilter(klass);
    setTimeout(() => window.print(), 300);
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
            <option key={i} value={i+1}>#{i+1}</option>
          ))}
        </select>
      </div>

      {/* Knappar */}
      {!playerView && (
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", margin:"8px 0" }}>
          <Button onClick={()=>fileRef.current.click()}>📥 Startlista</Button>
          <Button onClick={()=>resultRef.current.click()}>📥 Resultat</Button>
          <Button onClick={generateResults}>🏁 Skapa</Button>
          <Button onClick={exportExcel}>📊 Excel</Button>
          <Button onClick={exportPDF}>📄 PDF Total</Button>
          <Button onClick={()=>exportPDFClass("A")}>📄 PDF A</Button>
          <Button onClick={()=>exportPDFClass("B")}>📄 PDF B</Button>
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
              onChange={e=>{
                const v=e.target.value;
                setRounds(prev=>{
                  const copy=[...prev];
                  copy[currentRound-1].participants[i].net=v;
                  return copy;
                });
              }}
            />
          </div>
        ))}
      </Card>

      {/* Resultat */}
      {["A","B"].map(klass=>(
        <Card key={klass}>
          <strong>Resultat – Klass {klass}</strong>
          {current.results.filter(r=>r.class===klass).map((r,i)=>(
            <div key={i} style={{ fontSize:12, display:"flex", justifyContent:"space-between" }}>
              <span>{r.place}. {r.name} ({r.net})</span>
              <span>{r.points}p | {r.prize}kr</span>
            </div>
          ))}
        </Card>
      ))}

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
