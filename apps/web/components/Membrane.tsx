"use client";
import { useEffect, useRef } from "react";
import { cachedSprite, observeSpriteSpecs } from "./field/sprites";
import css from "./OperationalWork.module.css";

const colours = {
  mint: "123,231,198",
  violet: "182,161,239",
  amber: "248,189,118",
  blue: "135,199,235",
};
export default function Membrane({
  identity,
  strength = 0,
  tone = "mint",
}: {
  identity: string;
  strength?: number;
  tone?: keyof typeof colours;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const foldBand = Math.round(Math.max(0, Math.min(1, strength)) * 6);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const colour = colours[tone];
    const spec = {
      id: identity,
      colour,
      quality: 1,
      foldBand,
      pressure: false,
      key: JSON.stringify([identity, colour, 1, foldBand, false]),
    };
    const draw = () => {
      const sprite = cachedSprite(spec);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (sprite) ctx.drawImage(sprite, 0, 0, canvas.width, canvas.height);
    };
    draw();
    return observeSpriteSpecs([spec], draw);
  }, [identity, tone, foldBand]);
  return (
    <canvas
      className={css.membrane}
      width={360}
      height={270}
      ref={ref}
      aria-hidden="true"
    />
  );
}
