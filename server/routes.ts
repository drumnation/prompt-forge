import type { Express } from "express";
import { createServer, type Server } from "http";
import { db } from "@db";
import { templates } from "@db/schema";
import { eq } from "drizzle-orm";

export function registerRoutes(app: Express): Server {
  // Templates CRUD
  app.get("/api/templates", async (_req, res) => {
    console.log("GET /api/templates - Starting request");
    try {
      console.log("Executing Drizzle query to fetch templates...");
      const allTemplates = await db.select().from(templates).orderBy(templates.order);
      console.log("Query successful, found", allTemplates.length, "templates");
      res.json(allTemplates);
    } catch (error) {
      console.error("Error in /api/templates:", error);
      console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
      res.status(500).json({ 
        message: "Failed to fetch templates",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/templates", async (req, res) => {
    try {
      // Get max order and add new template at the end
      const maxOrder = await db.select({ order: templates.order })
        .from(templates)
        .orderBy(templates.order)
        .limit(1);

      const order = maxOrder.length > 0 ? maxOrder[0].order + 1 : 0;

      const [template] = await db
        .insert(templates)
        .values({ ...req.body, order })
        .returning();
      res.json(template);
    } catch (error) {
      console.error("Error creating template:", error);
      res.status(500).json({ 
        message: "Failed to create template",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.put("/api/templates/:id", async (req, res) => {
    try {
      const [template] = await db
        .update(templates)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(templates.id, parseInt(req.params.id)))
        .returning();
      res.json(template);
    } catch (error) {
      console.error("Error updating template:", error);
      res.status(500).json({ 
        message: "Failed to update template",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/templates/reorder", async (req, res) => {
    try {
      const orderedTemplates = req.body as { id: number; order: number }[];

      // Update each template's order in a transaction
      await db.transaction(async (tx) => {
        for (const { id, order } of orderedTemplates) {
          await tx.update(templates)
            .set({ order, updatedAt: new Date() })
            .where(eq(templates.id, id));
        }
      });

      const updatedTemplates = await db.select()
        .from(templates)
        .orderBy(templates.order);

      res.json(updatedTemplates);
    } catch (error) {
      console.error("Error reordering templates:", error);
      res.status(500).json({
        message: "Failed to reorder templates",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.delete("/api/templates/:id", async (req, res) => {
    try {
      await db
        .delete(templates)
        .where(eq(templates.id, parseInt(req.params.id)));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting template:", error);
      res.status(500).json({ 
        message: "Failed to delete template",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Gemini API Integration 
  app.post("/api/enhance", async (req, res) => {
    try {
      const apiKey = req.headers["x-api-key"];
      const provider = req.headers["x-provider"] || 'google';

      console.log("Backend - Enhance request received:", {
        provider,
        hasApiKey: !!apiKey,
        apiKeyLength: apiKey?.length,
        requestHeaders: {
          ...req.headers,
          "x-api-key": "[REDACTED]"
        },
        requestBody: {
          model: req.body.model,
          promptLength: req.body.prompt?.length
        }
      });

      if (!apiKey) {
        return res.status(401).json({ message: "API key is required" });
      }

      let response;
      let responseData;

      switch (provider) {
        case 'google':
            try {
              const modelId = req.body.model.replace(/^models\//, '');
              const url = new URL(`https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent`);
              url.searchParams.append("key", apiKey.toString());

              console.log("Backend - Google API request:", {
                url: url.toString().replace(apiKey.toString(), '[REDACTED]'),
                modelId: modelId,
                hasApiKey: !!apiKey
              });

              response = await fetch(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  contents: [{
                    parts: [{
                      text: req.body.prompt,
                    }],
                  }],
                  generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 2048, // Increased from 1024 to 2048 (Gemini max)
                  },
                }),
              });

              responseData = await response.json();
            } catch (error) {
              console.error("Backend - Google API request error:", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                requestDetails: {
                  model: req.body.model,
                  apiKeyPresent: !!apiKey
                }
              });
              throw error;
            }
            break;

        case 'openai':
            try {
              // the newest OpenAI model is "gpt-4o" which was released May 13, 2024
              console.log("Backend - OpenAI request:", {
                model: req.body.model,
                hasApiKey: !!apiKey
              });

              response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                  model: req.body.model,
                  messages: [{
                    role: 'user',
                    content: req.body.prompt
                  }],
                  temperature: 0.7,
                  max_tokens: 4096 // Increased from 1024 to 4096 (GPT max)
                })
              });

              responseData = await response.json();
            } catch (error) {
              console.error("Backend - OpenAI API request error:", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
              });
              throw error;
            }
            break;

        case 'anthropic':
            try {
              // the newest Anthropic model is "claude-3-7-sonnet-20250219" which was released February 24, 2025
              console.log("Backend - Anthropic request:", {
                model: req.body.model,
                hasApiKey: !!apiKey
              });

              response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': apiKey,
                  'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                  model: req.body.model,
                  messages: [{
                    role: 'user',
                    content: req.body.prompt
                  }],
                  max_tokens: 4096 // Increased from 1024 to 4096 (Claude max)
                })
              });

              responseData = await response.json();
            } catch (error) {
              console.error("Backend - Anthropic API request error:", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
              });
              throw error;
            }
            break;

        case 'deepseek':
            try {
              console.log("Backend - DeepSeek request:", {
                model: req.body.model,
                hasApiKey: !!apiKey
              });

              response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                  model: req.body.model,
                  messages: [{
                    role: 'user',
                    content: req.body.prompt
                  }],
                  temperature: 0.7,
                  max_tokens: 4096 // Increased from 1024 to 4096 (DeepSeek max)
                })
              });

              responseData = await response.json();
            } catch (error) {
              console.error("Backend - DeepSeek API request error:", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
              });
              throw error;
            }
            break;

        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }

      // Check response status
      if (!response.ok) {
        throw new Error(JSON.stringify({
          provider,
          status: response.status,
          error: responseData
        }));
      }

      let enhancedPrompt;

      switch (provider) {
        case 'google':
          if (!responseData.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error("Unexpected response format from Gemini API");
          }
          enhancedPrompt = responseData.candidates[0].content.parts[0].text;
          break;

        case 'openai':
          if (!responseData.choices?.[0]?.message?.content) {
            throw new Error("Unexpected response format from OpenAI API");
          }
          enhancedPrompt = responseData.choices[0].message.content;
          break;

        case 'anthropic':
          if (!responseData.content?.[0]?.text) {
            throw new Error("Unexpected response format from Anthropic API");
          }
          enhancedPrompt = responseData.content[0].text;
          break;

        case 'deepseek':
          if (!responseData.choices?.[0]?.message?.content) {
            throw new Error("Unexpected response format from DeepSeek API");
          }
          enhancedPrompt = responseData.choices[0].message.content;
          break;

        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }

      res.json({ enhancedPrompt });
    } catch (error) {
      console.error("Backend - Error enhancing prompt:", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });

      res.status(500).json({ 
        message: "Failed to enhance prompt",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}