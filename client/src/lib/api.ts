import { GeminiResponse, Template, CreateTemplateInput, UpdateTemplateInput } from './types';
import { getSelectedProviderApiKey } from './storage';

const API_BASE = '/api';

export async function getTemplates(): Promise<Template[]> {
  const res = await fetch(`${API_BASE}/templates`);
  if (!res.ok) throw new Error('Failed to fetch templates');
  return res.json();
}

export async function createTemplate(template: CreateTemplateInput): Promise<Template> {
  const res = await fetch(`${API_BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template)
  });
  if (!res.ok) throw new Error('Failed to create template');
  return res.json();
}

export async function duplicateTemplate(template: Template): Promise<Template> {
  // Create a new template with the same content but a different name
  const { id, createdAt, updatedAt, ...rest } = template;
  const newTemplate = {
    ...rest,
    name: `${template.name} (1)` // The backend will handle incrementing if this name exists
  };

  return createTemplate(newTemplate);
}

export async function updateTemplate(template: UpdateTemplateInput): Promise<Template> {
  const res = await fetch(`${API_BASE}/templates/${template.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template)
  });
  if (!res.ok) throw new Error('Failed to update template');
  return res.json();
}

export async function reorderTemplates(templates: Template[]): Promise<Template[]> {
  const reorderedTemplates = templates.map((template, index) => ({
    id: template.id,
    order: index
  }));

  const res = await fetch(`${API_BASE}/templates/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reorderedTemplates)
  });
  if (!res.ok) throw new Error('Failed to reorder templates');
  return res.json();
}

export async function deleteTemplate(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/templates/${id}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error('Failed to delete template');
}

export async function enhancePrompt(prompt: string): Promise<GeminiResponse> {
  const apiKey = getSelectedProviderApiKey();
  console.log('API Key present:', !!apiKey);

  if (!apiKey) {
    throw new Error('API key not found for the selected provider. Please add your API key in settings.');
  }

  try {
    const res = await fetch(`${API_BASE}/enhance`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({ prompt })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Enhancement request failed:', {
        status: res.status,
        statusText: res.statusText,
        errorText
      });
      throw new Error(`Enhancement failed: ${errorText}`);
    }

    return res.json();
  } catch (error) {
    console.error('Enhancement error:', error);
    throw error;
  }
}