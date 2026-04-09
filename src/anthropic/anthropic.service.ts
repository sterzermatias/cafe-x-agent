import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// SDK oficial de Anthropic para llamar a la API de Claude
import Anthropic from '@anthropic-ai/sdk';
import { type RSSEntry } from '../rss/rss.service.js';

// Interfaces que definen los contratos de entrada/salida de cada método
export interface ProfileAnalysisInput {
  tweets: string[];
}

export interface ProfileAnalysisResult {
  style: string;
  interests: string[];
}

export interface TweetFeedback {
  approved: { content: string }[];
  rejected: { content: string; rejection_reason?: string }[];
}

export interface ProfileContext {
  style: string;
  interests: string[];
}

export interface ContentValidationResult {
  safe: boolean;
  reason?: string;
}

// System prompt de seguridad — se inyecta en generación y validación de contenido
const CONTENT_RESTRICTIONS = `
MANDATORY CONTENT RESTRICTIONS — every generated text MUST comply:
- No sexual, explicit, or suggestive content.
- No offensive, hateful, or discriminatory language of any kind.
- No personal attacks or harassment.
- No misinformation or unverified claims presented as facts.
- Maintain a respectful, professional tone at all times.
- No violent or threatening content.
- No spam, scams, or deceptive content.
If the request conflicts with any of these restrictions, refuse and explain why.
`.trim();

// Wrapper sobre la API de Claude — 4 métodos públicos, cada uno con un prompt específico
// Usa Haiku (rápido/barato) para análisis y Sonnet (mejor calidad) para generación
@Injectable()
export class AnthropicService implements OnModuleInit {
  private readonly logger = new Logger(AnthropicService.name);
  private client: Anthropic;
  private haikuModel: string;
  private sonnetModel: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
    });

    this.haikuModel =
      this.config.get<string>('ANTHROPIC_HAIKU_MODEL') ||
      'claude-haiku-4-5-20251001';
    this.sonnetModel =
      this.config.get<string>('ANTHROPIC_SONNET_MODEL') ||
      'claude-sonnet-4-20250514';

    this.logger.log(
      `Anthropic client initialized (haiku: ${this.haikuModel}, sonnet: ${this.sonnetModel})`,
    );
  }

  // Analiza tweets del usuario y extrae su estilo de escritura + intereses (usa Haiku)
  async analyzeProfile(
    input: ProfileAnalysisInput,
  ): Promise<ProfileAnalysisResult> {
    const prompt = `You are a social media analyst. Analyze the following tweets from a user and extract:
1. Their writing style (tone, voice, typical sentence structure, use of slang/emojis, language patterns).
2. Their main interests and topics they engage with.

Tweets:
${input.tweets.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Respond ONLY with a JSON object in this exact format:
{
  "style": "A paragraph describing their writing style",
  "interests": ["interest1", "interest2", "interest3"]
}`;

    const text = await this.callApi(prompt, 1024);
    return this.extractJson<ProfileAnalysisResult>(text);
  }

  // Resume las entradas RSS en temas trending agrupados (usa Haiku)
  async summarizeTopics(rssEntries: RSSEntry[]): Promise<string> {
    const entries = rssEntries
      .map(
        (e, i) =>
          `${i + 1}. Title: ${e.title}\n   Snippet: ${e.contentSnippet}`,
      )
      .join('\n');

    const prompt = `You are a news analyst. Summarize the following RSS feed entries into a concise overview of trending topics and themes. Group related topics together. Focus on what's most relevant and newsworthy.

RSS Entries:
${entries}

Provide a clear, concise summary of the main trending topics (2-4 paragraphs).`;

    return await this.callApi(prompt, 1024);
  }

  // Genera un tweet imitando el estilo del usuario, con few-shot de aprobados/rechazados (usa Sonnet)
  async generateTweet(
    profile: ProfileContext,
    contentContext: string,
    feedback: TweetFeedback,
  ): Promise<string> {
    // Construye ejemplos de few-shot learning: tweets aprobados como ejemplos positivos
    const approvedExamples = feedback.approved.length
      ? `\nExamples of APPROVED tweets (match this quality):\n${feedback.approved.map((t) => `- "${t.content}"`).join('\n')}`
      : '';

    // Tweets rechazados como ejemplos negativos (con razón de rechazo si la hay)
    const rejectedExamples = feedback.rejected.length
      ? `\nExamples of REJECTED tweets (avoid these patterns):\n${feedback.rejected.map((t) => `- "${t.content}"${t.rejection_reason ? ` — Reason: ${t.rejection_reason}` : ''}`).join('\n')}`
      : '';

    const prompt = `You are a tweet ghostwriter. Generate a single tweet that matches the user's voice and style.

USER PROFILE:
- Writing style: ${profile.style}
- Interests: ${profile.interests.join(', ')}

CONTENT CONTEXT (use this as inspiration):
${contentContext}
${approvedExamples}
${rejectedExamples}

${CONTENT_RESTRICTIONS}

RULES:
- The tweet MUST be 280 characters or fewer (including the mandatory sign-off).
- Write in the user's natural voice and style.
- Make it engaging and authentic, not generic.
- Do NOT include hashtags unless the user's style typically uses them.
- Do NOT use quotes or wrap the tweet in quotes.
- The tweet MUST end with "aguante la pizza papa" as a sign-off. Always include it.

Respond with ONLY the tweet text, nothing else.`;

    return await this.callApi(prompt, 256, this.sonnetModel);
  }

  // Valida que un texto cumpla las restricciones de contenido (usa Haiku)
  async validateContent(text: string): Promise<ContentValidationResult> {
    const prompt = `You are a content safety reviewer. Evaluate the following text against these rules:

${CONTENT_RESTRICTIONS}

Text to evaluate:
"${text}"

Respond ONLY with a JSON object in this exact format:
{
  "safe": true or false,
  "reason": "explanation if not safe, omit this field if safe"
}`;

    const response = await this.callApi(prompt, 256);
    return this.extractJson<ContentValidationResult>(response);
  }

  // Método interno que hace la llamada real a la API con retry en caso de sobrecarga (529)
  private async callApi(
    prompt: string,
    maxTokens: number,
    model?: string,
  ): Promise<string> {
    // Si no se especifica modelo, usa Haiku (más barato para tareas simples)
    const selectedModel = model || this.haikuModel;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // messages.create es el endpoint principal de la API de Claude
        const response = await this.client.messages.create({
          model: selectedModel,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        });

        // La respuesta viene en bloques — extraemos el texto del primer bloque
        const block = response.content[0];
        if (block.type === 'text') {
          return block.text;
        }
        throw new Error(`Unexpected content block type: ${block.type}`);
      } catch (error: unknown) {
        // 529 = API sobrecargada — reintenta con exponential backoff (2s, 4s, 8s)
        const err = error as Record<string, unknown>;
        const nestedError = err?.error as Record<string, unknown> | undefined;
        const status =
          (err?.status as number) ?? (nestedError?.status as number);
        if (status === 529 && attempt < maxAttempts) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          this.logger.warn(
            `Anthropic API overloaded (529), retrying in ${backoffMs}ms (attempt ${attempt}/${maxAttempts})`,
          );
          await this.sleep(backoffMs);
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        this.logger.error(`Anthropic API call failed: ${message}`, stack);
        throw error;
      }
    }

    throw new Error('Anthropic API call failed after max retries');
  }

  // Limpia markdown code fences (```json...```) que Claude a veces agrega al JSON
  private extractJson<T>(text: string): T {
    const stripped = text
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();
    return JSON.parse(stripped) as T;
  }

  // Utilidad: Promise que resuelve después de N milisegundos (para backoff)
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
