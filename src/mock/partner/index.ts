/**
 * Partner / TDS mock
 */

interface AddAccessoryButtonOptions {
  id: string;
  title: string;
  icon: { name: string };
}

export const partner = {
  async addAccessoryButton(options: AddAccessoryButtonOptions): Promise<void> {
    console.log('[ait-devtools] partner.addAccessoryButton:', options);
  },
  async removeAccessoryButton(): Promise<void> {
    console.log('[ait-devtools] partner.removeAccessoryButton');
  },
};
