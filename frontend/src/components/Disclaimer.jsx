import { AlertTriangle } from 'lucide-react';

export function Disclaimer() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-6">
      <div className="flex items-center gap-2 text-amber-700 text-sm">
        <AlertTriangle size={16} />
        <span className="font-medium">Miễn trừ trách nhiệm, mang tính chất tham khảo, không phải là lời khuyên đầu tư</span>
      </div>
    </div>
  );
}
