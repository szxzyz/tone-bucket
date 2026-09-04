import CreatePanel from "@/components/CreatePanel";
import { useLocation } from "wouter";
import { useCallback } from "react";

export default function CreateTaskPage() {
  const [, setLocation] = useLocation();
  
  const handleClose = useCallback(() => {
    setLocation("/");
  }, [setLocation]);

  // CreatePanel expects 'open', 'onClose', and 'onFlowChange'.
  // We force 'open={true}' because this is a dedicated page.
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#000' }}>
      <CreatePanel 
        open={true} 
        onClose={handleClose} 
      />
    </div>
  );
}
