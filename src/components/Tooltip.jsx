import { useState } from "react";

export default function Tooltip({ text, children }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="tooltip-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open ? <span className="tooltip-bubble">{text}</span> : null}
    </span>
  );
}
