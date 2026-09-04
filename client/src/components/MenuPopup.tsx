import { X } from "lucide-react";

interface MenuPopupProps {
  onClose: () => void;
}

// Minimal placeholder menu popup. The Games and Rewards pages reference this
// component, but no concrete menu design has been implemented yet.
export default function MenuPopup({ onClose }: MenuPopupProps) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
        }}
        onClick={onClose}
      />
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          background: "#1a1d27",
          borderRadius: 12,
          padding: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close menu"
          style={{
            background: "transparent",
            border: "none",
            color: "#9ca3af",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 4,
          }}
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
