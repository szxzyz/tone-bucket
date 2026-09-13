interface GoldIconProps {
  size?: number;
  className?: string;
}

export function GoldIcon({ size = 20, className = "" }: GoldIconProps) {
  return (
    <span
      className={`flex-shrink-0 inline-block ${className}`}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: '50%',
        overflow: 'hidden',
        display: 'inline-block',
        position: 'relative',
      }}
    >
      <img
        src="/assets/gold-icon.png"
        alt="Gold"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%) scale(1.18)',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </span>
  );
}
