export interface Server {
  id: string;
  name: string;
  activeShops: number;
  lastUpdated: string;
  lastUpdatedHuman?: string;
  createdAt: string;
  rating: {
    likes: number;
    dislikes: number;
  };
  difficulty: 'easy' | 'medium' | 'hard';
  status: 'active' | 'paused';
  links: {
    discord?: string;
    forum?: string;
    website?: string;
  };
  playerCount?: number;
}

export interface NewsItem {
  id: string;
  title: string;
  description?: string;
  date: string;
  type: 'feature' | 'server' | 'update' | 'news' | 'changelog';
}

export interface FAQ {
  id: string;
  question: string;
  answer: string;
}

export interface ServerCandidate {
  id: string;
  name: string;
  votes: number;
  requestedBy: string;
}
