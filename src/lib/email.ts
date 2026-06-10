import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { getSettings } from '@/lib/settingsStore';

export async function checkEmailsForProjects() {
  const settings = getSettings() as any;
  const config = {
    imap: {
      user: settings.imapUser || process.env.IMAP_USER || '',
      password: settings.imapPass || process.env.IMAP_PASSWORD || '',
      host: settings.imapHost || process.env.IMAP_HOST || 'imap.gmail.com',
      port: Number(settings.imapPort) || Number(process.env.IMAP_PORT) || 993,
      tls: true,
      authTimeout: 3000
    }
  };

  if (!config.imap.user || !config.imap.password) {
    throw new Error('IMAP-gegevens zijn niet geconfigureerd.');
  }

  try {
    const connection = await imaps.connect(config);
    await connection.openBox('INBOX');

    const searchCriteria = ['UNSEEN'];
    const fetchOptions = { bodies: ['HEADER', 'TEXT'], markSeen: true };
    const results = await connection.search(searchCriteria, fetchOptions);

    const parsedProjects = [];

    for (const res of results) {
      const allParts = imaps.getParts(res.parts as any);
      const textPart = allParts.find((part: any) => part.which === 'TEXT');
      
      if (textPart) {
        const parsedMail = await simpleParser(textPart.body);
        const content = parsedMail.text || '';
        
        const project = parseEmailContentToProject(content);
        if (project.songs.length > 0 || project.scriptures.length > 0) {
          parsedProjects.push(project);
        }
      }
    }

    connection.end();
    return parsedProjects;
  } catch (error) {
    console.error('IMAP Error:', error);
    throw error;
  }
}

function parseEmailContentToProject(text: string) {
  const lines = text.split('\n');
  const project = { date: new Date().toLocaleDateString('nl-NL'), songs: [] as string[], scriptures: [] as string[] };
  
  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;

    // Detect format: Title - Artist
    if (cleanLine.includes(' - ') && !/\d:\d/.test(cleanLine)) {
      project.songs.push(cleanLine);
    }
    // Detect Bible verse: Book Chapter:Verse(s)
    else if (/\d:\d/.test(cleanLine)) {
      project.scriptures.push(cleanLine);
    }
    // Detect date if specified like "12/04/26"
    else if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(cleanLine)) {
      project.date = cleanLine;
    }
  }

  return project;
}
