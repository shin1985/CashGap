import { useEffect, useState } from "react";
import { formatCurrency } from "../lib/format";

export default function EditableCell({
  value,
  onChange,
  type = "number",
  placeholder = "-",
  readOnly = false,
  align = "right",
  accentColor,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));

  useEffect(() => {
    if (!editing) {
      setDraft(String(value ?? ""));
    }
  }, [editing, value]);

  if (readOnly) {
    return (
      <div className="cell-display" style={{ textAlign: align, color: accentColor || "inherit" }}>
        {type === "number" ? formatCurrency(Number(value || 0)) : value || placeholder}
      </div>
    );
  }

  if (!editing) {
    const rendered =
      type === "number"
        ? value !== "" && value != null
          ? formatCurrency(Number(value || 0))
          : placeholder
        : value || placeholder;

    return (
      <button
        type="button"
        className="cell-button"
        style={{ textAlign: align, color: accentColor || "inherit" }}
        onClick={() => setEditing(true)}
      >
        {rendered}
      </button>
    );
  }

  return (
    <input
      autoFocus
      className="cell-input"
      type={type === "number" ? "number" : "text"}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setEditing(false);
        onChange(type === "number" ? Number(draft || 0) : draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(String(value ?? ""));
          setEditing(false);
        }
      }}
      style={{ textAlign: align }}
    />
  );
}
