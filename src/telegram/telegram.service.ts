import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// grammy: framework para bots de Telegram (como telegraf pero más moderno)
import { Bot, InlineKeyboard, type Context } from 'grammy';
import { LearningService } from '../learning/learning.service.js';
import { TweetGeneratorService } from '../tweet-generator/tweet-generator.service.js';

// Bot de Telegram — interfaz principal del usuario para interactuar con el agente
// Implementa OnModuleInit (arranca el bot) y OnModuleDestroy (lo frena limpiamente)
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Bot;
  private allowedUserId: number;
  // Map temporal en memoria: guarda qué tweet está esperando razón de rechazo por usuario
  private readonly pendingRejectOther = new Map<number, number>();

  constructor(
    private readonly configService: ConfigService,
    private readonly learningService: LearningService,
    private readonly tweetGeneratorService: TweetGeneratorService,
  ) {}

  onModuleInit() {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN')!;
    this.allowedUserId = Number(
      this.configService.get<string>('TELEGRAM_ALLOWED_USER_ID'),
    );

    this.bot = new Bot(token);

    // Middleware de seguridad: solo responde al usuario autorizado (whitelist)
    // bot.use() intercepta TODOS los mensajes antes de llegar a los handlers
    this.bot.use(async (ctx, next) => {
      if (ctx.from?.id !== this.allowedUserId) {
        this.logger.warn(`Unauthorized access attempt: ${ctx.from?.id}`);
        return; // No llama a next() → bloquea el request
      }
      await next(); // Pasa al siguiente handler
    });

    // Registra handlers separados por tipo: comandos, callbacks de botones, texto libre
    this.registerCommands();
    this.registerCallbackHandlers();
    this.registerTextHandler();

    // Error handler global del bot
    this.bot.catch((err) => {
      this.logger.error(`Bot error: ${err.message}`, err.stack);
    });

    // "void" porque start() es async pero no queremos awaitearlo (corre indefinidamente)
    void this.bot.start({
      onStart: () => this.logger.log('Telegram bot started'),
    });
  }

  // Lifecycle hook: NestJS lo llama cuando la app se apaga (SIGTERM, Ctrl+C)
  async onModuleDestroy() {
    await this.bot.stop();
  }

  // Método público para que otros servicios envíen notificaciones vía Telegram
  async sendNotification(message: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(this.allowedUserId, message);
    } catch (error) {
      this.logger.error(`Notification failed: ${error}`);
    }
  }

  // Envía una propuesta de tweet con el mismo teclado inline que /generar
  // (Aprobar / Rechazar / Regenerar). Lo usa el cron de propuesta diaria.
  async sendProposal(tweetId: number, tweet: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(
        this.allowedUserId,
        `📝 Tweet propuesto:\n\n${tweet}`,
        { reply_markup: this.buildProposalKeyboard(tweetId) },
      );
    } catch (error) {
      this.logger.error(`Proposal send failed: ${error}`);
    }
  }

  // Registra comandos de Telegram (/start, /status, /aprender, /generar, /tema)
  private registerCommands() {
    this.bot.command('start', async (ctx) => {
      try {
        await ctx.reply(
          '👋 ¡Hola! Soy tu agente de tweets.\n\n' +
            'Comandos disponibles:\n' +
            '/aprender — Analizar tu export de tweets\n' +
            '/generar — Generar un nuevo tweet\n' +
            '/tema <texto> — Generar tweet sobre un tema\n' +
            '/pendientes — Ver tweets pendientes de aprobación (últimas 12h)\n' +
            '/status — Ver estadísticas\n' +
            '/start — Ver este mensaje',
        );
      } catch (error) {
        this.logger.error(`/start error: ${error}`);
        await this.safeReply(ctx, 'Error al procesar el comando.');
      }
    });

    this.bot.command('status', async (ctx) => {
      try {
        const stats = await this.tweetGeneratorService.getStats();

        if (stats.total === 0) {
          await ctx.reply(
            'No hay tweets generados aún.\nUsá /generar para crear el primero.',
          );
          return;
        }

        let message =
          `📊 Estadísticas:\n\n` +
          `Total: ${stats.total}\n` +
          `⏳ Pendientes: ${stats.pending}\n` +
          `✅ Aprobados: ${stats.approved}\n` +
          `📤 Publicados: ${stats.published}\n` +
          `❌ Rechazados: ${stats.rejected}\n` +
          `💀 Fallidos: ${stats.failed}\n\n` +
          `Hoy: ${stats.todayCount} generados\n` +
          `Tasa de aprobación: ${stats.approvalRate}%`;

        if (stats.lastPublished) {
          message += `\n\nÚltimo publicado:\n"${stats.lastPublished.content}"\n${stats.lastPublished.url}`;
        }

        await ctx.reply(message);
      } catch (error) {
        this.logger.error(`/status error: ${error}`);
        await this.safeReply(ctx, 'Error al obtener estadísticas.');
      }
    });

    // /aprender: analiza el export de tweets y construye el perfil del usuario
    this.bot.command('aprender', async (ctx) => {
      try {
        await ctx.reply('Analizando tu export de tweets...');
        const profile = await this.learningService.analyzeFromExport();
        await ctx.reply(
          `Perfil analizado!\nEstilo: ${profile.style}\nIntereses: ${profile.interests.join(', ')}`,
        );
      } catch (error) {
        this.logger.error(`/aprender error: ${error}`);
        await this.safeReply(
          ctx,
          `Error al analizar: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    // /generar: genera un tweet y lo presenta con botones de aprobar/rechazar/regenerar
    this.bot.command('generar', async (ctx) => {
      try {
        await ctx.reply('Generando tweet...');
        const result = await this.tweetGeneratorService.generate();
        // reply_markup agrega un teclado inline (botones debajo del mensaje)
        await ctx.reply(result.tweet, {
          reply_markup: this.buildProposalKeyboard(result.id),
        });
      } catch (error) {
        this.logger.error(`/generar error: ${error}`);
        await this.safeReply(
          ctx,
          `Error al generar: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    // /pendientes: lista tweets pendientes de aprobación de las últimas 12 horas
    // Cada tweet viene con su teclado de Aprobar/Rechazar/Regenerar, más un botón global "Aprobar todos"
    this.bot.command('pendientes', async (ctx) => {
      try {
        const pending = await this.tweetGeneratorService.listPending(12);

        if (pending.length === 0) {
          await ctx.reply('No hay tweets pendientes en las últimas 12 horas.');
          return;
        }

        await ctx.reply(`📋 ${pending.length} tweet(s) pendiente(s):`);

        for (const tweet of pending) {
          await ctx.reply(tweet.content, {
            reply_markup: this.buildProposalKeyboard(tweet.id),
          });
        }

        // Botón final para aprobar todos los pendientes de una
        await ctx.reply('¿Aprobar todos?', {
          reply_markup: new InlineKeyboard().text(
            '✅ Aprobar todos',
            'approve_all',
          ),
        });
      } catch (error) {
        this.logger.error(`/pendientes error: ${error}`);
        await this.safeReply(
          ctx,
          `Error al listar pendientes: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    // /tema <texto>: genera un tweet sobre un tema específico dado por el usuario
    this.bot.command('tema', async (ctx) => {
      try {
        // Extrae el texto después de "/tema " usando regex
        const topic = ctx.message?.text?.replace(/^\/tema\s*/, '').trim();

        if (!topic) {
          await ctx.reply('Uso: /tema <texto>');
          return;
        }

        await ctx.reply('Generando tweet...');
        const result = await this.tweetGeneratorService.generate({ topic });
        await ctx.reply(result.tweet, {
          reply_markup: this.buildProposalKeyboard(result.id),
        });
      } catch (error) {
        this.logger.error(`/tema error: ${error}`);
        await this.safeReply(
          ctx,
          `Error al generar: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  // Registra handlers para los botones inline (callbacks)
  // Cada botón tiene un callback_data que matchea con regex
  private registerCallbackHandlers() {
    // Aprobar → publica en Twitter
    this.bot.callbackQuery(/^approve:(\d+)$/, async (ctx) => {
      try {
        await ctx.answerCallbackQuery('Publicando...');
        // ctx.match[1] extrae el grupo capturado del regex (el ID del tweet)
        const tweetId = Number(ctx.match[1]);
        const result = await this.tweetGeneratorService.approve(tweetId);

        // editMessageText reemplaza el mensaje original (quita los botones)
        if (result.alreadyPublished) {
          await ctx.editMessageText(`✅ Ya publicado: ${result.url}`);
        } else if (result.success) {
          await ctx.editMessageText(`✅ Publicado: ${result.url}`);
        } else {
          await ctx.editMessageText(
            '⚠️ Aprobado pero falló la publicación. Se reintentará automáticamente.',
          );
        }
      } catch (error) {
        this.logger.error(`approve callback error: ${error}`);
        await ctx.answerCallbackQuery('Error al aprobar');
      }
    });

    // Rechazar → muestra sub-menú con razones predefinidas
    this.bot.callbackQuery(/^reject:(\d+)$/, async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const tweetId = Number(ctx.match[1]);
        // Reemplaza los botones por el teclado de razones de rechazo
        await ctx.editMessageReplyMarkup({
          reply_markup: this.buildRejectionKeyboard(tweetId),
        });
      } catch (error) {
        this.logger.error(`reject callback error: ${error}`);
        await ctx.answerCallbackQuery('Error');
      }
    });

    // Razón de rechazo predefinida (Muy formal, Off-topic, etc.)
    this.bot.callbackQuery(/^reject_reason:(\d+):(.+)$/, async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const tweetId = Number(ctx.match[1]);
        const reason = ctx.match[2];
        await this.tweetGeneratorService.reject(tweetId, reason);
        await ctx.editMessageText(`❌ Rechazado: ${reason}`);
      } catch (error) {
        this.logger.error(`reject_reason callback error: ${error}`);
        await ctx.answerCallbackQuery('Error al rechazar');
      }
    });

    // "Otro" → guarda el tweetId en pendingRejectOther y espera texto libre del usuario
    this.bot.callbackQuery(/^reject_other:(\d+)$/, async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const tweetId = Number(ctx.match[1]);
        // Guarda en el Map qué tweet espera razón — el próximo mensaje de texto lo resuelve
        this.pendingRejectOther.set(ctx.from.id, tweetId);
        await ctx.editMessageText('Escribí la razón:');
      } catch (error) {
        this.logger.error(`reject_other callback error: ${error}`);
        await ctx.answerCallbackQuery('Error');
      }
    });

    // Aprobar todos los pendientes de las últimas 12h en batch
    this.bot.callbackQuery('approve_all', async (ctx) => {
      try {
        await ctx.answerCallbackQuery('Aprobando todos...');
        const pending = await this.tweetGeneratorService.listPending(12);

        if (pending.length === 0) {
          await ctx.editMessageText('No había pendientes para aprobar.');
          return;
        }

        let published = 0;
        let failed = 0;
        for (const tweet of pending) {
          try {
            const result = await this.tweetGeneratorService.approve(tweet.id);
            if (result.success || result.alreadyPublished) {
              published++;
            } else {
              failed++;
            }
          } catch (err) {
            this.logger.error(`approve_all: tweet ${tweet.id} failed: ${err}`);
            failed++;
          }
        }

        await ctx.editMessageText(
          `✅ Aprobados: ${pending.length}\n` +
            `📤 Publicados: ${published}\n` +
            (failed > 0
              ? `⚠️ Fallaron publicación (se reintentan): ${failed}`
              : ''),
        );
      } catch (error) {
        this.logger.error(`approve_all callback error: ${error}`);
        await ctx.answerCallbackQuery('Error al aprobar todos');
      }
    });

    this.bot.callbackQuery('regenerate', async (ctx) => {
      try {
        await ctx.answerCallbackQuery('Regenerando...');
        const result = await this.tweetGeneratorService.generate();
        await ctx.editMessageText(result.tweet, {
          reply_markup: this.buildProposalKeyboard(result.id),
        });
      } catch (error) {
        this.logger.error(`regenerate callback error: ${error}`);
        await ctx.answerCallbackQuery('Error al regenerar');
      }
    });
  }

  // Captura mensajes de texto libre — solo actúa si hay un rechazo pendiente de razón
  private registerTextHandler() {
    this.bot.on('message:text', async (ctx) => {
      const pendingId = this.pendingRejectOther.get(ctx.from.id);
      if (pendingId) {
        this.pendingRejectOther.delete(ctx.from.id);
        try {
          await this.tweetGeneratorService.reject(pendingId, ctx.message.text);
          await ctx.reply(`❌ Rechazado: ${ctx.message.text}`);
        } catch (error) {
          this.logger.error(`free-text reject error: ${error}`);
          await this.safeReply(ctx, 'Error al rechazar el tweet.');
        }
      }
    });
  }

  // Construye el teclado inline con Aprobar / Rechazar / Regenerar
  private buildProposalKeyboard(tweetId: number): InlineKeyboard {
    return new InlineKeyboard()
      .text('✅ Aprobar', `approve:${tweetId}`)
      .text('❌ Rechazar', `reject:${tweetId}`)
      .row() // .row() agrega una nueva fila de botones
      .text('🔄 Regenerar', 'regenerate');
  }

  // Sub-menú de razones de rechazo — cada botón incluye tweetId:razón en el callback_data
  private buildRejectionKeyboard(tweetId: number): InlineKeyboard {
    return new InlineKeyboard()
      .text('Muy formal', `reject_reason:${tweetId}:Muy formal`)
      .text('Off-topic', `reject_reason:${tweetId}:Off-topic`)
      .row()
      .text('No suena a mí', `reject_reason:${tweetId}:No suena a mí`)
      .text('Aburrido', `reject_reason:${tweetId}:Aburrido`)
      .row()
      .text('Otro', `reject_other:${tweetId}`);
  }

  // Wrapper que no explota si falla el reply (ej: usuario bloqueó el bot)
  private async safeReply(ctx: Context, message: string): Promise<void> {
    try {
      await ctx.reply(message);
    } catch (error) {
      this.logger.error(`Failed to send reply: ${error}`);
    }
  }
}
