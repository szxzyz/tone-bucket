import type { ReactNode } from "react";


type Props = {
  children: ReactNode;
  onClose: () => void;
  maxWidth?: number;
  zIndex?: number;
  closeOnBackdrop?: boolean;
};

/**
 * Shared modal treatment used by the menu and action popups.
 * Keeping the animation and frame in one place prevents sheets from
 * drifting into different visual styles.
 */
export default function PopupShell({
  children,
  onClose,
  maxWidth = 390,
  zIndex = 1000,
  closeOnBackdrop = true,
}: Props) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "max(12px, env(safe-area-inset-left)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom))",
      }}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={closeOnBackdrop ? onClose : undefined}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.50)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          willChange: "backdrop-filter",
        }}
      />
      <div
        onClick={event => event.stopPropagation()}
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth,
          maxHeight: "min(88dvh, calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px))",
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          background: "#0a0a0a",
          boxShadow: "0 20px 70px rgba(0,0,0,0.55)",
          borderRadius: 20,
          padding: "22px 18px max(20px, calc(env(safe-area-inset-bottom, 0px) + 12px))",
        }}
      >
        {children}
      </div>
    </div>
  );
}
