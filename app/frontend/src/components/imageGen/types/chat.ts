export interface Message {
    id: string;
    sender: "user" | "bot";
    text: string;
    image?: string;
  }
  
  export interface StableDiffusionChatProps {
    onBack: () => void;
  }
  
  