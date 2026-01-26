// =========================================================
// HERRGOLF – FULL TÄVLINGSAPP
// =========================================================

import { useState, useMemo, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

/* =========================================================
   UI-KOMPONENTER
========================================================= */

const Card = ({ children }) => (
  <div style={{
    background: "white",
    borderRadius: 8,
    border: "1px solid #ccc",
    padding: 12,
    marginBottom: 12
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
      border: "1px solid #888",
      background: "#f3f3f3",
      cursor: "pointer"
    }}
  >
    {children}
  </button>
);

const Input = (props) => (
  <input
    {...props}
    style={{
      padding: 4,
      borderRadius: 4,
      border: "1px solid #aaa",
      width: "100%"
    }}
  />
);

/* =========================================================
   KONFIGURATION
========================================================= */

const ROUNDS = 16;
const STORAGE_KEY = "herrgolf_state";

const CLUB_NAME = "Hammarö GK";
const CLUB_COLOR = "#0f6d3b";
const BG_COLOR = "#e5f2ea";
const LOGO =
  "https://www.hammarogk.se/media/k2mkxwg0/hammarogk-logo.png?height=240";

const ADMIN_PASSWORD = "HammaroGK26";
const roundName = (n) => `Herrgolf #${n}`;
const GOLF_ID_REGEX = /^\d{6}-\d{3}$/;

/* =========================================================
   HJÄLPFUNKTIONER
========================================================= */

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
    const index = sorted.findIndex((s) => s.golfId === p.golfId);
    return { ...p, class: index < half ? "A" : "B" };
  });
}

/* =========================================================
   APP
========================================================= */

export default function App() {
  const fileRef = useRef(null);
  const resultRef = useRef(null);

  const [loggedIn, setLoggedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [currentRound, setCurrentRound] = useState(1);

  const emptyRounds = Array.from({ length: ROUNDS }).map(() => ({
    participants: [],
    results: [],
    locked: false
  }));

  const [rounds, setRounds] = useState(emptyRounds);

  /* ================= LAGRING ================= */

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setRounds(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rounds));
  }, [rounds]);

  /* ================= EXCEL ================= */

  const readExcel = async (file) => {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet);
  };

  const importParticipants = async (file) => {
    const rows = await readExcel(file);

    const parsed = rows
      .map((r) => ({
        name: String(r.Namn || r.namn || "").trim(),
        golfId: String(r["Golf-ID"] || r.golfId || "").trim(),
        hcp: Number(r.HCP || r.hcp || 0),
        net: ""
      }))
      .filter((p) => GOLF_ID_REGEX.test(p.golfId));

    const withClass = assignClasses(parsed);

    setRounds((prev) => {
      const copy = [...prev];
      copy[currentRound - 1].participants = withClass;
      copy[currentRound - 1].results = [];
      return copy;
    });
  };

  const importResults = async (file) => {
    const rows = await readExcel(file);

    setRounds((prev) => {
      const copy = [...prev];
      const round = copy[currentRound - 1];

      round.participants = round.participants.map((p) => {
        const match = rows.find(
          (r) =>
            String(r["Golf-ID"] || r.golfId || "").trim() === p.golfId
        );
        if (!match) return p;
        return { ...p, net: Number(match.Netto || match.netto || 0) };
      });

      return copy;
    });
  };

  const generateResults = () => {
    setRounds((prev) => {
      const copy = [...prev];
      const part = copy[currentRound - 1].participants;

      const results = ["A", "B"].flatMap((klass) => {
        const filtered = part
          .filter((p) => p.class === klass && p.net !== "")
          .sort((a, b) => a.net - b.net);

        return filtered.map((p, idx) => ({
          ...p,
          place: idx + 1,
          points: calculatePoints(idx + 1)
        }));
      });

      copy[currentRound - 1].results = results;
      return copy;
    });
  };

  const totals = useMemo(() => {
    const map = {};
    rounds.forEach((r) => {
      r.results.forEach((res) => {
        if (!map[res.golfId]) {
          map[res.golfId] = { ...res, total: 0 };
        }
        map[res.golfId].total += res.points;
      });
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [rounds]);

  /* ================= LOGIN ================= */

  if (!loggedIn) {
    return (
      <div style={{ background: BG_COLOR, minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center" }}>
        <Card>
          <img src={LOGO} style={{ height: 80, display: "block", margin: "0 auto" }} />
          <h3 style={{ textAlign: "center" }}>Admin login</h3>
          <Input
            type="password"
            placeholder="Lösenord"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button onClick={() => password === ADMIN_PASSWORD ? setLoggedIn(true) : alert("Fel lösenord")}>
            Logga in
          </Button>
        </Card>
      </div>
    );
  }

  const current = rounds[currentRound - 1];

  /* ================= UI ================= */

  return (
    <div style={{ background: "#111", minHeight: "100vh", display: "flex", justifyContent: "center" }}>
      <div style={{ width: 420, background: BG_COLOR, padding: 12 }}>

        <img src={LOGO} style={{ width: "100%" }} />
        <h2 style={{ color: CLUB_COLOR }}>{CLUB_NAME} – {roundName(currentRound)}</h2>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <Button onClick={() => fileRef.current.click()}>Importera startlista</Button>
          <Button onClick={() => resultRef.current.click()}>Importera resultat</Button>
          <Button onClick={generateResults}>Skapa resultat</Button>
        </div>

        <input ref={fileRef} hidden type="file" accept=".xlsx" onChange={(e) => importParticipants(e.target.files[0])} />
        <input ref={resultRef} hidden type="file" accept=".xlsx" onChange={(e) => importResults(e.target.files[0])} />

        <Card>
          <h3>Startlista</h3>
          {current.participants.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 4 }}>
              <div style={{ flex: 1 }}>{p.name}</div>
              <div>{p.class}</div>
              <input
                style={{ width: 50 }}
                type="number"
                value={p.net}
                onChange={(e) => {
                  const value = e.target.value;
                  setRounds(prev => {
                    const copy = [...prev];
                    copy[currentRound - 1].participants[i].net = value;
                    return copy;
                  });
                }}
              />
            </div>
          ))}
        </Card>

        <Card>
          <h3>Totalställning</h3>
          {totals.map((t, i) => (
            <div key={i}>{i + 1}. {t.name} – {t.total} p</div>
          ))}
        </Card>

      </div>
    </div>
  );
}
