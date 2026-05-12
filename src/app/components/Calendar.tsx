"use client";

import { useEffect, useState, useMemo } from "react";
import pageStyles from "../page.module.css";
import styles from "./Calendar.module.css";

interface PnLData {
  [day: number]: number;
}

export function CalendarButton() {
  const [open, setOpen] = useState(false);
  
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={pageStyles.railActionBtn}
        onClick={() => setOpen(true)}
        aria-label="Open PnL calendar"
      >
        <span className={pageStyles.railActionBtnIcon}>🗓</span>
        <span className={pageStyles.railActionBtnLabel}>PnL Calendar</span>
        <span className={pageStyles.railActionBtnHint}>Daily breakdown</span>
      </button>
      {open && <CalendarModal onClose={() => setOpen(false)} />}
    </>
  );
}

function CalendarModal({ onClose }: { onClose: () => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1); // 1-indexed
  const [data, setData] = useState<PnLData>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const res = await fetch(`/api/journal/pnl?year=${year}&month=${month}`);
        if (res.ok) {
          const json = await res.json();
          setData(json.data || {});
        }
      } catch (err) {
        console.error("Failed to fetch calendar PnL", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [year, month]);

  const { totalPnl, cells } = useMemo(() => {
    const sum = Object.values(data).reduce((acc, val) => acc + val, 0);

    // 0 = Sunday, 1 = Monday
    const firstDay = new Date(year, month - 1, 1).getDay(); 
    const daysInMonth = new Date(year, month, 0).getDate();

    const gridCells: { type: "empty" | "day"; day?: number; pnl?: number }[] = [];

    for (let i = 0; i < firstDay; i++) {
        gridCells.push({ type: "empty" });
    }

    for (let d = 1; d <= daysInMonth; d++) {
        gridCells.push({ type: "day", day: d, pnl: data[d] || 0 });
    }

    // Trailing blanks
    while (gridCells.length % 7 !== 0) {
        gridCells.push({ type: "empty" });
    }

    return { totalPnl: sum, cells: gridCells };
  }, [data, year, month]);

  const monthOptions = [];
  const now = new Date();
  const currentTotalMonths = now.getFullYear() * 12 + now.getMonth();
  for (let m = currentTotalMonths; m >= 2023 * 12; m--) {
    const optionYear = Math.floor(m / 12);
    const optionMonth = (m % 12) + 1;
    monthOptions.push({ year: optionYear, month: optionMonth });
  }

  const sign = (v: number) => (v > 0 ? "+" : "");
  const colorClass = (v: number) => {
    if (v > 0) return styles.gain;
    if (v < 0) return styles.loss;
    return styles.neutral;
  };

  return (
    <div className={pageStyles.modalBackdrop} onClick={onClose} role="presentation">
      <div
        className={`${pageStyles.modalCard} ${styles.modalCardCalendar}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className={pageStyles.modalHeader}>
          <div className={pageStyles.modalTitle + " font-display"}>
            Earnings Calendar 收益日历
          </div>
          <button type="button" className={pageStyles.modalClose} onClick={onClose}>×</button>
        </div>

        <div className={styles.controls}>
          <select 
            className={styles.monthSelect}
            value={`${year}-${month}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              setYear(y);
              setMonth(m);
            }}
          >
            {monthOptions.slice(0, 24).map((opt) => ( // Show last 24 months
              <option key={`${opt.year}-${opt.month}`} value={`${opt.year}-${opt.month}`}>
                {opt.year} / {opt.month.toString().padStart(2, "0")}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.summaryBox}>
          <div>
            <div className={styles.summaryLabel}>
              {new Date(year, month - 1).toLocaleString('default', { month: 'short' })} Earnings
            </div>
            <div className={`${styles.summaryValue} ${colorClass(totalPnl)} tabular-nums`}>
              {loading ? "..." : `${sign(totalPnl)}${totalPnl.toFixed(2)}`}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className={styles.summaryLabel}>Total Return</div>
            <div className={`${styles.summaryValue} ${colorClass(totalPnl)} tabular-nums`}>
              {loading ? "..." : `${sign(totalPnl)}${totalPnl.toFixed(2)}`}
            </div>
          </div>
        </div>

        <div className={styles.gridHeader}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
            <div key={`header-${i}`} className={styles.weekday}>{day}</div>
          ))}
        </div>

        <div className={styles.grid}>
          {cells.map((cell, i) => {
            if (cell.type === "empty") {
              return <div key={`empty-${i}`} className={styles.emptyCell} />;
            }
            
            const hasData = cell.pnl !== 0;
            return (
              <div 
                key={`day-${cell.day}`} 
                className={styles.cell}
              >
                <div className={`${styles.dayNumber} tabular-nums`}>{cell.day}</div>
                {hasData && (
                  <div className={`${styles.dayPnl} ${colorClass(cell.pnl!)} tabular-nums`}>
                    {sign(cell.pnl!)}{Math.abs(cell.pnl!).toFixed(2)}
                  </div>
                )}
                {!hasData && (
                  <div className={`${styles.dayPnl} ${styles.neutral} tabular-nums`}>
                    +0.00
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
