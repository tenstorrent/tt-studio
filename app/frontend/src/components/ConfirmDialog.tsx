import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/src/components/ui/alert-dialog";
export function ConfirmDialog({
    alertTrigger,
    dialogTitle,
    dialogDescription,
    onConfirm,
    cancelText,
    confirmText,
  }: {
    cancelText?: string,
    confirmText?: string,
    dialogTitle: string,
    dialogDescription: string,
    alertTrigger: React.ReactNode;
    onConfirm: React.MouseEventHandler<HTMLButtonElement>;
  }) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>{alertTrigger}</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {dialogDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{cancelText || 'Cancel'} </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>{confirmText || 'Continue'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }