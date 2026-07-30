import { useState } from "react";
import { ArrowRight } from "lucide-react";
import Button from "../../../../components/ui/Button.jsx";
import ImageUploader from "../../../../components/ui/ImageUploader.jsx";

export default function ImageAnswer({ onSubmit, disabled, currentValue }) {
  const [url, setUrl] = useState(currentValue ?? null);

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <ImageUploader
        value={url}
        onChange={setUrl}
        previewHeightClass="h-56"
        className="w-full max-w-sm"
        aspectRatio={4 / 5}
      />
      <Button disabled={disabled || !url} onClick={() => onSubmit(url)}>
        Continuar
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
