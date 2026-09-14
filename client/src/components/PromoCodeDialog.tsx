import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PromoCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function PromoCodeDialog({ open, onOpenChange }: PromoCodeDialogProps) {
  const [promoCode, setPromoCode] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const redeemPromoMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("POST", "/api/promo-codes/redeem", { code });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/earnings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/stats"] });
      setPromoCode("");
      onOpenChange(false);
      toast({
        title: "Success! 🎉",
        description: data.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to redeem promo code",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!promoCode.trim()) {
      toast({
        title: "Error",
        description: "Please enter a promo code",
        variant: "destructive",
      });
      return;
    }

    redeemPromoMutation.mutate(promoCode.trim().toUpperCase());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[20px] bg-black/95 overflow-hidden border border-white/10 p-0">
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-blue-500 to-transparent" />
        <div className="p-6 pt-5">
        <DialogHeader>
          <DialogTitle className="text-white">
            Redeem Promo Code
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Enter your promo code to claim rewards and bonuses
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Input
              id="promo-code"
              placeholder="Enter code"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              disabled={redeemPromoMutation.isPending}
              data-testid="input-promo-code"
              className="bg-transparent border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleSubmit}
              disabled={redeemPromoMutation.isPending || !promoCode.trim()}
              className="flex-1 bg-[#6b21a8] hover:bg-[#3d1580] text-white rounded-[20px]"
              data-testid="button-redeem-promo"
            >
              {redeemPromoMutation.isPending ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  Redeeming...
                </>
              ) : (
                'Redeem Code'
              )}
            </Button>
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
