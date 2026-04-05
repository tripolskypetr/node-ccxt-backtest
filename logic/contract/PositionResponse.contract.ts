interface PositionResponseContract {
    action: "OPEN" | "WAIT",
    open_price: number;
    stop_loss_price: number;
    take_profit_price: number;
    reasoning: string;
}

export { PositionResponseContract };
