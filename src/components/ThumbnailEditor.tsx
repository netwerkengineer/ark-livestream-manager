"use client";

import React, { useEffect, useRef, useState } from "react";
import * as fabric from "fabric";
import { Type, Image as ImageIcon, Download, Trash2, Plus, Maximize } from "lucide-react";

interface ThumbnailEditorProps {
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}

export default function ThumbnailEditor({ onSave, onClose }: ThumbnailEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvas = useRef<fabric.Canvas | null>(null);

  useEffect(() => {
    if (canvasRef.current && !fabricCanvas.current) {
      // De interne resolutie is nu 1280x720 voor HD kwaliteit
      const canvas = new fabric.Canvas(canvasRef.current, {
        width: 1280,
        height: 720,
        backgroundColor: "#1a1a1f",
      });
      fabricCanvas.current = canvas;

      // De visuele weergave schalen we via de style van het canvas element
      const canvasEl = canvas.getElement();
      if (canvasEl) {
        // We tonen het canvas op een handelbaar formaat in de UI
        canvasEl.parentElement!.style.maxWidth = "800px";
        canvasEl.parentElement!.style.margin = "0 auto";
        canvasEl.style.width = "100%";
        canvasEl.style.height = "auto";
      }

      // Canvas is nu leeg voor eigen ontwerpen
    }

    return () => {
      if (fabricCanvas.current) {
        fabricCanvas.current.dispose();
        fabricCanvas.current = null;
      }
    };
  }, []);

  const addText = () => {
    if (fabricCanvas.current) {
      const text = new fabric.IText("Nieuwe Tekst", {
        left: 150,
        top: 150,
        fontFamily: "Inter, sans-serif",
        fill: "#ffffff",
        fontSize: 60,
      });
      fabricCanvas.current.add(text);
      fabricCanvas.current.setActiveObject(text);
    }
  };

  const addImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && fabricCanvas.current) {
      const reader = new FileReader();
      reader.onload = async (f) => {
        const data = f.target?.result as string;
        const img = await fabric.FabricImage.fromURL(data);
        
        // Bereken schaling om het canvas te vullen (Cover mode)
        const canvasWidth = fabricCanvas.current!.width!;
        const canvasHeight = fabricCanvas.current!.height!;
        const scaleX = canvasWidth / img.width!;
        const scaleY = canvasHeight / img.height!;
        const scale = Math.max(scaleX, scaleY);
        
        img.scale(scale);
        
        fabricCanvas.current?.add(img);
        fabricCanvas.current?.sendObjectToBack(img); // Als achtergrond instellen
        fabricCanvas.current?.centerObject(img);
        fabricCanvas.current?.requestRenderAll();
      };
      reader.readAsDataURL(file);
    }
  };

  const deleteSelected = () => {
    if (fabricCanvas.current) {
      const activeObjects = fabricCanvas.current.getActiveObjects();
      fabricCanvas.current.remove(...activeObjects);
      fabricCanvas.current.discardActiveObject();
      fabricCanvas.current.requestRenderAll();
    }
  };

  const handleSave = () => {
    if (fabricCanvas.current) {
      // Export op volle 1280x720 resolutie
      const dataUrl = fabricCanvas.current.toDataURL({
        format: "png",
        quality: 1,
        multiplier: 1, // Zorgt voor de 1:1 resolutie (1280x720)
      });
      onSave(dataUrl);
    }
  };

  const centerSelected = () => {
    if (fabricCanvas.current) {
      const active = fabricCanvas.current.getActiveObject();
      if (active) {
        fabricCanvas.current.centerObject(active);
        fabricCanvas.current.requestRenderAll();
      }
    }
  };

  return (
    <div className="glass-card" style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3>Thumbnail Bewerken (1280x720)</h3>
        <button onClick={onClose} className="btn-outline" style={{ padding: '6px 12px' }}>Sluiten</button>
      </div>

      <div style={{ display: 'flex', gap: '20px' }}>
        {/* Sidebar Tools */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '60px' }}>
          <button onClick={addText} className="btn-outline" style={{ padding: '12px' }} title="Tekst toevoegen">
            <Type size={20} />
          </button>
          <label className="btn-outline" style={{ padding: '12px', cursor: 'pointer', display: 'flex', justifyContent: 'center' }} title="Afbeelding uploaden">
            <Plus size={20} />
            <input type="file" hidden accept="image/*" onChange={addImage} />
          </label>
          <button onClick={centerSelected} className="btn-outline" style={{ padding: '12px' }} title="Centreren">
            <Maximize size={20} />
          </button>
          <hr style={{ borderColor: 'var(--card-border)', margin: '8px 0' }} />
          <button onClick={deleteSelected} className="btn-outline" style={{ padding: '12px', color: '#ff4d4d' }} title="Verwijderen">
            <Trash2 size={20} />
          </button>
        </div>

        {/* Canvas Area */}
        <div style={{ flex: 1, border: '1px solid var(--card-border)', borderRadius: '8px', overflow: 'hidden', background: '#000' }}>
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <canvas ref={canvasRef} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginRight: 'auto', alignSelf: 'center' }}>
          Afbeeldingen worden automatisch geschaald om het vlak te vullen.
        </p>
        <button className="btn-primary" onClick={handleSave}>
          <Download size={18} />
          Opslaan & Gebruiken
        </button>
      </div>
    </div>
  );
}
