"use client";

import { useId, useMemo, useRef, useState } from "react";
import { locationLabel, resolveLocation, searchLocations, type LocationOption } from "@flight-lens/contracts";

type Props = {
  label: string;
  value: { kind: "city" | "airport"; code: string };
  onChange(value: LocationOption): void;
  onValidityChange(valid: boolean): void;
};

export function LocationCombobox({ label, value, onChange, onValidityChange }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => resolveLocation(value.kind, value.code), [value.kind, value.code]);
  const [query, setQuery] = useState(() => selected ? locationLabel(selected) : value.code);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [valid, setValid] = useState(Boolean(selected));
  const options = useMemo(() => searchLocations(query), [query]);

  function choose(option: LocationOption) {
    setQuery(locationLabel(option));
    setOpen(false);
    setValid(true);
    onValidityChange(true);
    onChange(option);
    inputRef.current?.focus();
  }

  return (
    <div className="location-field">
      <label htmlFor={id}>{label}</label>
      <div className="location-combobox">
        <input ref={inputRef} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open}
          aria-controls={`${id}-listbox`} aria-activedescendant={open && options[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
          aria-invalid={!valid} autoComplete="off" value={query} placeholder="城市、机场、拼音或 IATA"
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); setValid(false); onValidityChange(false); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(Math.max(0, options.length - 1), index + 1)); }
            else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
            else if (event.key === "Enter" && open && options[activeIndex]) { event.preventDefault(); choose(options[activeIndex]); }
            else if (event.key === "Escape") setOpen(false);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)} />
        {open && <ul id={`${id}-listbox`} role="listbox" className="location-options">
          {options.length === 0 ? <li className="location-empty">未找到匹配地点</li> : options.map((option, index) => (
            <li id={`${id}-option-${index}`} key={`${option.kind}-${option.code}`} role="option" aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
              <span>{option.kind === "city" ? option.cityNameZh : option.airportNameZh}</span>
              <small>{option.kind === "city" ? `所有机场 · ${option.airportCodes.join(" / ")}` : `${option.cityNameZh} · ${option.code}`}</small>
              <b>{option.code}</b>
            </li>
          ))}
        </ul>}
      </div>
      {!valid && <small className="location-error">请从候选列表选择城市或机场</small>}
    </div>
  );
}
