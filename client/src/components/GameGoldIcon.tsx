interface GoldIconProps {
  size?: number;
  className?: string;
}

export function GoldIcon({ size = 20, className = "" }: GoldIconProps) {
  return (
    <img
      src="/assets/gem-icon.png"
      alt="Gold"
      className={`flex-shrink-0 inline-block ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        objectFit: 'contain',
        display: 'block',
      }}
    />
  );
}
